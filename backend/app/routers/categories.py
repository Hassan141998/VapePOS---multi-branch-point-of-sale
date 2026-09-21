"""Product categories. Products point at a category by NAME, so renaming one updates its products too."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Category, Discount, Product, User
from app.realtime import manager
from app.schemas import CategoryIn, CategoryOut, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["Categories"])


def ensure_category(db: Session, name: str | None) -> None:
    """Make sure a category row exists for `name` (products can arrive from imports and the demo seed)."""
    if not name:
        return
    if not db.scalar(select(Category.id).where(Category.name == name)):
        db.add(Category(name=name))
        db.flush()


def sync_categories(db: Session) -> None:
    """Create rows for any category name that products use but the table does not know yet."""
    known = set(db.scalars(select(Category.name)).all())
    used = {c for c in db.scalars(select(Product.category).where(Product.category.is_not(None)).distinct()).all() if c}
    missing = used - known
    if missing:
        db.add_all([Category(name=n) for n in sorted(missing)])
        db.commit()


def _out(db: Session, categories: list[Category]) -> list[CategoryOut]:
    counts = dict(db.execute(select(Product.category, func.count(Product.id)).group_by(Product.category)).all())
    return [
        CategoryOut(id=c.id, name=c.name, description=c.description, product_count=int(counts.get(c.name, 0)))
        for c in categories
    ]


@router.get("", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sync_categories(db)
    return _out(db, list(db.scalars(select(Category).order_by(func.lower(Category.name))).all()))


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    body: CategoryIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give the category a name.")
    if db.scalar(select(Category.id).where(func.lower(Category.name) == name.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, "A category with this name already exists.")
    cat = Category(name=name, description=(body.description or "").strip() or None)
    db.add(cat)
    db.commit()
    background.add_task(manager.publish, "category.updated", [], {})
    return _out(db, [cat])[0]


@router.put("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int,
    body: CategoryUpdate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        new = data["name"].strip()
        if not new:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give the category a name.")
        clash = db.scalar(select(Category.id).where(func.lower(Category.name) == new.lower(), Category.id != cat.id))
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, "A category with this name already exists.")
        if new != cat.name:
            db.execute(update(Product).where(Product.category == cat.name).values(category=new))
            db.execute(update(Discount).where(Discount.category == cat.name).values(category=new))
            cat.name = new
    if "description" in data:
        cat.description = (data["description"] or "").strip() or None
    db.commit()
    background.add_task(manager.publish, "category.updated", [], {})
    return _out(db, [cat])[0]


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    in_use = db.scalar(select(func.count(Product.id)).where(Product.category == cat.name)) or 0
    if in_use:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{in_use} product(s) still use this category. Move them to another category first.",
        )
    if db.scalar(select(func.count(Discount.id)).where(Discount.category == cat.name)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A discount is tied to this category. Edit or delete that discount first.")
    db.delete(cat)
    db.commit()
    background.add_task(manager.publish, "category.updated", [], {})
