"""
services/verification.py — Simplified verification service.

VerificationService: atomic writer for verification verdicts on PhoneNumber.
VerificationEngine has been removed — background verification is gone.

VERIFICATION STATUS VOCABULARY
--------------------------------
  "pending"   -- not yet evaluated
  "verified"  -- passed quality audit
  "rejected"  -- flagged as low-quality / non-actionable
"""

from typing import Optional

from exceptions import PhoneNumberNotFoundError
from models.phone_number import PhoneNumber
from repositories.storage import Storage

_VALID_STATUSES = frozenset({"pending", "verified", "rejected"})


class VerificationService:
    """
    Atomic database writer for verification field updates on PhoneNumber.
    Sole writer to `verification_status` on the PhoneNumber table.
    """

    def __init__(self, storage: Storage) -> None:
        self.phones = storage.phones

    def apply_verdict(
        self,
        phone_id: str,
        status: str,
        extra_data: Optional[dict] = None,
    ) -> PhoneNumber:
        """
        Write a verification verdict to a PhoneNumber row.

        Args:
            phone_id:   PK of the PhoneNumber row.
            status:     Must be one of 'pending', 'verified', 'rejected'.
            extra_data: Optional metadata merged into phone.extra_data.

        Returns:
            PhoneNumber: Updated, committed PhoneNumber.

        Raises:
            PhoneNumberNotFoundError: phone_id does not exist.
            ValueError: status is not a valid value.
        """
        if status not in _VALID_STATUSES:
            raise ValueError(
                f"Invalid verification status '{status}'. "
                f"Valid values: {', '.join(sorted(_VALID_STATUSES))}."
            )
        phone = self.phones.get(phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        phone.verification_status = status

        if extra_data:
            merged = dict(phone.extra_data or {})
            merged.update(extra_data)
            phone.extra_data = merged

        return self.phones.update(phone)
