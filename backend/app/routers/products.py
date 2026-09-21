from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Product, User
from app.realtime import manager
from app.routers.categories import ensure_category
from app.schemas import ProductIn, ProductOut, ProductUpdate
from app.services.inventory import create_rows_for_new_product

router = APIRouter(prefix="/products", tags=["Products"])


def _out(product: Product, user: User) -> ProductOut:
    out = ProductOut.model_validate(product)
    out.buying_price = product.buying_price if user.role in ("admin", "manager") else None
    return out


@router.get("", response_model=list[ProductOut])
def list_products(
    search: str | None = Query(None, description="Matches name, barcode, brand or flavor"),
    category: str | None = None,
    include_inactive: bool = False,
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Product).order_by(Product.name, Product.id)
    if not include_inactive:
        stmt = stmt.where(Product.is_active.is_(True))
    if category:
        stmt = stmt.where(Product.category == category)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(Product.name.ilike(like), Product.barcode.ilike(like), Product.brand.ilike(like), Product.flavor.ilike(like))
        )
    return [_out(p, user) for p in db.scalars(stmt.limit(limit).offset(offset)).all()]


@router.get("/barcode/{barcode}", response_model=ProductOut)
def product_by_barcode(barcode: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Used by the POS barcode scanner."""
    product = db.scalar(select(Product).where(Product.barcode == barcode, Product.is_active.is_(True)))
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No product with this barcode")
    return _out(product, user)


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(
    body: ProductIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    if db.scalar(select(Product.id).where(Product.barcode == body.barcode)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A product with this barcode already exists.")
    product = Product(**body.model_dump())
    db.add(product)
    ensure_category(db, product.category)
    db.flush()
    create_rows_for_new_product(db, product)  # zero-stock row at every branch
    db.commit()
    background.add_task(manager.publish, "product.updated", [], {"product_id": product.id})
    return _out(product, user)


@router.put("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    body: ProductUpdate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    data = body.model_dump(exclude_unset=True)
    if "barcode" in data and data["barcode"] != product.barcode:
        if db.scalar(select(Product.id).where(Product.barcode == data["barcode"])):
            raise HTTPException(status.HTTP_409_CONFLICT, "A product with this barcode already exists.")
    for key, value in data.items():
        setattr(product, key, value)
    ensure_category(db, product.category)
    db.commit()
    background.add_task(manager.publish, "product.updated", [], {"product_id": product.id})
    return _out(product, user)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_product(
    product_id: int,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    """Products that were sold cannot be deleted; they are hidden from the POS instead."""
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    product.is_active = False
    db.commit()
    background.add_task(manager.publish, "product.updated", [], {"product_id": product.id})
