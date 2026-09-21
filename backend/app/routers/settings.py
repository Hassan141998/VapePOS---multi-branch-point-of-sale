"""Business-wide settings: shop profile / currency (System Settings) and receipt layout (Receipt Designer)."""
from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings as env
from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import AppSetting, User
from app.realtime import manager
from app.schemas import BusinessSettings, ReceiptDesign, SettingsOut

router = APIRouter(prefix="/settings", tags=["Settings"])


def load_setting(db: Session, key: str, model: type[BaseModel]):
    """Stored JSON -> validated model. Missing or damaged data falls back to the defaults."""
    row = db.get(AppSetting, key)
    try:
        return model.model_validate(row.value if row else {})
    except ValueError:
        return model()


def save_setting(db: Session, key: str, value: BaseModel) -> None:
    payload = value.model_dump(mode="json")
    row = db.get(AppSetting, key)
    if row:
        row.value = payload
    else:
        db.add(AppSetting(key=key, value=payload))
    db.commit()


@router.get("", response_model=SettingsOut)
def get_settings_all(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return SettingsOut(
        business=load_setting(db, "business", BusinessSettings),
        receipt=load_setting(db, "receipt", ReceiptDesign),
        timezone=env.business_timezone,
    )


@router.put("/business", response_model=BusinessSettings)
def put_business(
    body: BusinessSettings,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    body.currency = body.currency.upper()
    save_setting(db, "business", body)
    background.add_task(manager.publish, "settings.updated", [], {})
    return body


@router.put("/receipt", response_model=ReceiptDesign)
def put_receipt(
    body: ReceiptDesign,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    save_setting(db, "receipt", body)
    background.add_task(manager.publish, "settings.updated", [], {})
    return body
