"""Deterministic synthetic retail data (clearly labelled synthetic) and an opt-in demo project.

The same seed always produces byte-identical tables. Distributions are designed to make
analytics meaningful: upward trend, weekly + yearly seasonality (Nov/Dec peak), skewed prices,
customer segments with different basket sizes, a handful of injected anomalies (a flash-sale
spike and an outage dip), and a small share of missing values for data-quality demos.

CLI:  python -m app.demo --out ./demo-data --seed 42
"""

import argparse
import io
import math
import random
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import polars as pl
from sqlalchemy.orm import Session

from app.ingestion.adapters import ImportOptions
from app.models import DataSource, Project, User
from app.services import dashboards as dashboard_svc
from app.services import datasets as dataset_svc
from app.services import projects as project_svc

START, END = date(2023, 1, 1), date(2025, 6, 30)
CATEGORIES = {
    "Electronics": (180.0, 0.7), "Home": (55.0, 0.6), "Apparel": (40.0, 0.5),
    "Sports": (70.0, 0.6), "Beauty": (25.0, 0.4),
}
REGIONS = [
    ("R1", "North America", "United States", "A. Rivera", 1.0),
    ("R2", "Europe", "Germany", "B. Schmidt", 0.75),
    ("R3", "Asia Pacific", "Singapore", "C. Tan", 0.6),
    ("R4", "Latin America", "Brazil", "D. Costa", 0.35),
    ("R5", "Middle East & Africa", "South Africa", "E. Mokoena", 0.25),
]
SEGMENTS = [("Consumer", 0.62, 1.0), ("Small Business", 0.28, 1.8), ("Enterprise", 0.10, 3.5)]
ANOMALIES = {date(2024, 11, 29): 3.2, date(2024, 3, 14): 0.15}  # flash sale, outage


def generate(seed: int = 42, n_customers: int = 2000, n_products: int = 60, base_orders: float = 22.0
             ) -> dict[str, pl.DataFrame]:
    rng = random.Random(seed)

    regions = pl.DataFrame({
        "region_id": [r[0] for r in REGIONS], "region_name": [r[1] for r in REGIONS],
        "hq_country": [r[2] for r in REGIONS], "manager": [r[3] for r in REGIONS],
    })

    products: list[dict[str, Any]] = []
    for i in range(n_products):
        category = list(CATEGORIES)[i % len(CATEGORIES)]
        median, sigma = CATEGORIES[category]
        price = round(median * math.exp(rng.gauss(0, sigma)), 2)
        products.append({
            "product_id": f"P{i + 1:03d}", "product_name": f"{category} item {i // len(CATEGORIES) + 1:02d}",
            "category": category, "unit_price": price, "unit_cost": round(price * rng.uniform(0.45, 0.72), 2),
            "launch_date": START + timedelta(days=rng.randint(-400, 500)),
        })
    popularity = [rng.paretovariate(1.4) for _ in products]

    customers: list[dict[str, Any]] = []
    region_weights = [r[4] for r in REGIONS]
    for i in range(n_customers):
        seg = rng.choices(SEGMENTS, weights=[s[1] for s in SEGMENTS])[0]
        customers.append({
            "customer_id": f"C{i + 1:05d}", "customer_name": f"Synthetic Customer {i + 1:05d}",
            "segment": seg[0], "region_id": rng.choices([r[0] for r in REGIONS], weights=region_weights)[0],
            "signup_date": START + timedelta(days=rng.randint(-700, (END - START).days - 30)),
            "email_opt_in": rng.random() < 0.55 if rng.random() > 0.03 else None,  # ~3% missing
        })
    seg_basket = {s[0]: s[2] for s in SEGMENTS}

    orders: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    order_no = 0
    day = START
    total_days = (END - START).days
    while day <= END:
        t = (day - START).days / total_days
        trend = 1.0 + 0.6 * t
        weekly = 1.25 if day.weekday() >= 5 else 1.0
        yearly = 1.0 + 0.35 * math.exp(-((day.timetuple().tm_yday - 340) / 25) ** 2)  # holiday peak
        lam = base_orders * trend * weekly * yearly * ANOMALIES.get(day, 1.0)
        n = max(0, int(rng.gauss(lam, math.sqrt(lam))))
        for _ in range(n):
            order_no += 1
            cust = customers[rng.randrange(n_customers)]
            if cust["signup_date"] > day:
                cust = customers[rng.randrange(n_customers)]
            channel = rng.choices(["Online", "Store", "Partner"], weights=[0.58, 0.32, 0.10])[0]
            status = rng.choices(["completed", "returned", "cancelled"], weights=[0.92, 0.05, 0.03])[0]
            n_lines = min(6, 1 + int(rng.expovariate(1 / seg_basket[cust["segment"]])))
            revenue = 0.0
            for line in range(n_lines):
                p = rng.choices(products, weights=popularity)[0]
                qty = 1 + int(rng.expovariate(0.9) * (2 if cust["segment"] == "Enterprise" else 1))
                discount = rng.choice([0, 0, 0, 0.05, 0.1, 0.15]) if day not in ANOMALIES else 0.25
                line_rev = round(qty * p["unit_price"] * (1 - discount), 2)
                revenue += line_rev
                items.append({"order_id": f"O{order_no:07d}", "line_no": line + 1, "product_id": p["product_id"],
                              "quantity": qty, "unit_price": p["unit_price"], "discount": discount,
                              "line_revenue": line_rev})
            orders.append({
                "order_id": f"O{order_no:07d}", "order_date": day, "customer_id": cust["customer_id"],
                "region_id": cust["region_id"], "segment": cust["segment"], "channel": channel, "status": status,
                "item_count": n_lines, "revenue": round(revenue, 2) if status != "cancelled" else 0.0,
                # ~1.5% of shipping costs missing, to exercise data-quality features
                "shipping_cost": round(rng.uniform(3, 25), 2) if rng.random() > 0.015 else None,
            })
        day += timedelta(days=1)

    snapshots: list[dict[str, Any]] = []
    month = date(START.year, START.month, 1)
    while month <= END:
        for p, pop in zip(products, popularity, strict=True):
            demand = pop * 12
            snapshots.append({"snapshot_date": month, "product_id": p["product_id"],
                              "on_hand": max(0, int(rng.gauss(demand * 3, demand))),
                              "reorder_point": int(demand * 1.5)})
        month = date(month.year + (month.month // 12), month.month % 12 + 1, 1)

    return {
        "sales_regions": regions,
        "products": pl.DataFrame(products),
        "customers": pl.DataFrame(customers),
        "orders": pl.DataFrame(orders),
        "order_items": pl.DataFrame(items),
        "inventory_snapshots": pl.DataFrame(snapshots),
    }


TABLE_NAMES = {
    "orders": "Orders", "order_items": "Order items", "products": "Products", "customers": "Customers",
    "sales_regions": "Sales regions", "inventory_snapshots": "Inventory snapshots",
}


def create_demo_project(db: Session, user: User, seed: int = 42) -> Project:
    """Create a new project populated with synthetic data through the normal import pipeline."""
    project = project_svc.create_project(
        db, user, "Retail demo (synthetic)",
        f"Synthetic retail dataset generated locally with seed {seed}. All names and figures are fictitious.",
        is_demo=True,
    )
    tables = generate(seed)
    ids: dict[str, str] = {}
    for table, frame in tables.items():
        buf = io.BytesIO()
        frame.write_parquet(buf)
        buf.seek(0)
        source: DataSource = dataset_svc.save_upload(db, project, user, f"{table}.parquet", buf)
        ds, _ = dataset_svc.start_import(db, project, user, source, TABLE_NAMES[table], table,
                                         "Synthetic demo data", ImportOptions())
        ids[table] = ds.id

    dash = dashboard_svc.create_dashboard(db, project, user, "Retail performance", "Synthetic demo dashboard")
    o = ids["orders"]

    def w(title: str, col: int, row: int, wd: int, h: int, display: dict[str, Any] | None = None,
          **query: Any) -> dict[str, Any]:
        return {"title": title, "dataset_id": o, "query": {"chart_type": query.pop("chart_type"), **query},
                "display": display or {}, "layout": {"x": col, "y": row, "w": wd, "h": h}}

    money = {"number_format": "currency", "currency": "USD"}

    revenue = [{"column": "revenue", "agg": "sum", "label": "revenue"}]
    dashboard_svc.save_definition(db, user, dash, {
        "name": "Retail performance",
        "widgets": [
            w("Total revenue", 0, 0, 3, 3, money, chart_type="kpi", measures=revenue),
            w("Orders", 3, 0, 3, 3, chart_type="kpi", measures=[{"agg": "count", "label": "orders"}]),
            w("Average order value", 6, 0, 3, 3, money, chart_type="kpi",
              measures=[{"column": "revenue", "agg": "avg", "label": "aov"}]),
            w("Customers", 9, 0, 3, 3, chart_type="kpi",
              measures=[{"column": "customer_id", "agg": "count_distinct", "label": "customers"}]),
            w("Monthly revenue", 0, 3, 8, 7, {"number_format": "compact"}, chart_type="area",
              dimension="order_date", date_grain="month", measures=revenue),
            w("Revenue by channel", 8, 3, 4, 7, chart_type="donut", dimension="channel", measures=revenue),
            w("Revenue by segment and region", 0, 10, 7, 7, chart_type="stacked_bar", dimension="region_id",
              series="segment", measures=revenue),
            w("Order value distribution", 7, 10, 5, 7, chart_type="histogram", y="revenue", bins=30),
        ],
        "filters": [
            {"dataset_id": o, "column": "order_date", "filter_type": "date_range", "label": "Order date"},
            {"dataset_id": o, "column": "segment", "filter_type": "category", "label": "Segment"},
            {"dataset_id": o, "column": "channel", "filter_type": "category", "label": "Channel"},
        ],
    })
    return project


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the synthetic Aether demo dataset")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--format", choices=["csv", "parquet"], default="csv")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for name, frame in generate(args.seed).items():
        path = args.out / f"{name}.{args.format}"
        frame.write_csv(path) if args.format == "csv" else frame.write_parquet(path)
        print(f"{path}  {frame.height:,} rows")


if __name__ == "__main__":
    main()
