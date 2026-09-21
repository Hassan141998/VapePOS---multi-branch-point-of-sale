"""Business-day helpers. "Today" is decided by BUSINESS_TIMEZONE, not by the server's clock."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.config import settings


def tz() -> ZoneInfo:
    return ZoneInfo(settings.business_timezone)


def today_local() -> date:
    return datetime.now(tz()).date()


def day_start_utc(d: date) -> datetime:
    """Midnight at the start of local day `d`, expressed in UTC."""
    return datetime.combine(d, time.min, tzinfo=tz()).astimezone(timezone.utc)


def day_bounds(d: date) -> tuple[datetime, datetime]:
    """[start, end) of local day `d` in UTC (DST-safe: uses the next local midnight)."""
    return day_start_utc(d), day_start_utc(d + timedelta(days=1))
