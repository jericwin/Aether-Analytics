"""email verification

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-04 04:06:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'email_verifications',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('code', sa.String(length=6), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_email_verifications')),
    )
    with op.batch_alter_table('email_verifications', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_email_verifications_email'), ['email'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('email_verifications', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_email_verifications_email'))
    op.drop_table('email_verifications')

