"""categories, discounts, business settings, sale discounts

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-21 06:37:42.217209
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('app_settings',
    sa.Column('key', sa.String(length=50), nullable=False),
    sa.Column('value', sa.JSON(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('categories',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=50), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('discounts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('type', sa.String(length=10), nullable=False),
    sa.Column('value', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('applies_to', sa.String(length=10), server_default='all', nullable=False),
    sa.Column('category', sa.String(length=50), nullable=True),
    sa.Column('product_id', sa.Integer(), nullable=True),
    sa.Column('min_purchase', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False),
    sa.Column('starts_on', sa.Date(), nullable=True),
    sa.Column('ends_on', sa.Date(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("applies_to IN ('all','category','product')", name='ck_discount_scope'),
    sa.CheckConstraint("type <> 'percent' OR value <= 100", name='ck_discount_percent'),
    sa.CheckConstraint("type IN ('percent','fixed')", name='ck_discount_type'),
    sa.CheckConstraint('min_purchase >= 0', name='ck_discount_min_purchase'),
    sa.CheckConstraint('value > 0', name='ck_discount_value'),
    sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.add_column('sale_items', sa.Column('discount_amount', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False))
    op.add_column('sales', sa.Column('discount_amount', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False))
    op.add_column('sales', sa.Column('discount_code', sa.String(length=40), nullable=True))
    op.add_column('sales', sa.Column('discount_name', sa.String(length=100), nullable=True))

    # Seed the categories the app always had, plus any category name products already use.
    op.execute("""
        INSERT INTO categories (name, description) VALUES
          ('device', 'Vape devices and kits'),
          ('pod', 'Pods and cartridges'),
          ('coil', 'Replacement coils'),
          ('e-liquid', 'E-liquids and nicotine salts'),
          ('disposable', 'Disposable vapes'),
          ('accessory', 'Batteries, chargers and other accessories')
        ON CONFLICT (name) DO NOTHING
    """)
    op.execute("""
        INSERT INTO categories (name)
        SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> ''
        ON CONFLICT (name) DO NOTHING
    """)


def downgrade() -> None:
    op.drop_column('sales', 'discount_name')
    op.drop_column('sales', 'discount_code')
    op.drop_column('sales', 'discount_amount')
    op.drop_column('sale_items', 'discount_amount')
    op.drop_table('discounts')
    op.drop_table('categories')
    op.drop_table('app_settings')
