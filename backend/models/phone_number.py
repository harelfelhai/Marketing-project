"""
models/phone_number.py — The `PhoneNumber` table (Channel + Internal Evaluation).

Represents a unique communication endpoint owned by an `Entity`.
Encapsulates FOUR conceptual concerns in one normalised row:

    1. CORE IDENTITY            — what number this is and whom it belongs to.
    2. PHASE 1 (INGESTION)      — how & why this number entered the pipeline.
    3. PHASE 3 (VERIFICATION)   — internal quality audit of the number.
    4. PHASE DY (SCORING)       — confidence + priority floats driving the
                                  prioritised review queue. Written by
                                  ScoringService, read by the operator UI.

PHASE 2 (External Dispatching / Campaigns) is intentionally NOT stored
here — it lives in `models/action_log.py` as a separate event log.
This keeps internal evaluation logic structurally isolated from
outbound communication events.

PRIVACY CONTRACT
----------------
All proprietary algorithmic outputs, vendor-specific identifiers, and
sensitive ingestion/verification metadata MUST live inside the
`extra_data` JSON column. The structured columns below capture only
generic lifecycle state and the abstract scoring floats.

TIMESTAMP CONTRACT (Phase DY migration)
---------------------------------------
Every datetime column on this table is `UTCDateTime` (tz-aware UTC).
Writes of naive `datetime.utcnow()` are rejected at the column boundary;
use `models.types.utc_now()` instead. The migration was bundled with
DY-1 to avoid a half-tz-aware state where the new confidence/priority
timestamps would be aware while ingested_at/verified_at remained naive
— a known comparison hazard in mixed schemas.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from models.types import UTCDateTime, utc_now as _utc_now


class PhoneNumber(SQLModel, table=True):
    """
    A telephone number tracked through the full pipeline lifecycle.

    Lifecycle blocks:
        * Ingestion (Phase 1): `ingestion_*` columns
        * Verification (Phase 3): `verification_*` columns
        * Dispatch events (Phase 2): see `ActionLog` rows referencing this row

    The `classification_type` field is intentionally a free-form string;
    its allowed values are resolved at runtime by a separate utility
    module (to be added in a later milestone), so the database schema
    remains business-secret-blind.
    """

    __tablename__ = "phone_number"

    # ==================================================================
    # CORE IDENTIFIERS
    # ==================================================================

    id: Optional[int] = Field(
        default=None,
        primary_key=True,
        description="Auto-incrementing primary key.",
    )
    """Surrogate primary key. Auto-assigned by the database on insert."""

    entity_id: int = Field(
        foreign_key="entity.id",
        index=True,
        nullable=False,
        description="FK to `Entity.id` — the owner of this number.",
    )
    """
    Foreign key linking this number to its owning Entity. Indexed for
    efficient "fetch all numbers for entity X" lookups.
    """

    phone_number: str = Field(
        index=True,
        unique=True,
        nullable=False,
        description="Literal phone number (E.164 recommended). Unique + indexed.",
    )
    """
    The raw phone number string.

    Storage convention (recommended, NOT enforced):
        Use E.164 format (e.g. "+14155551234"). Normalisation is the
        responsibility of the IngestionEngine before insertion.

    A UNIQUE index prevents the same number from existing in two rows
    simultaneously. If your business rules require historical re-ingest,
    use `extra_data` for revision metadata instead of duplicating rows.
    """

    classification_type: Optional[str] = Field(
        default=None,
        index=True,
        description="Internal system classification (resolved at runtime).",
    )
    """
    Generic classification label.

    The MEANING of each label is intentionally NOT defined in this
    codebase. A separate utility (to be introduced later) will translate
    these strings to business semantics at runtime. Internal teams may
    map them to proprietary segmentation taxonomies.

    Examples (illustrative only): "tier_a", "tier_b", "country_us".
    """

    # ==================================================================
    # PHASE 1 BLOCK — INGESTION DATA
    # ==================================================================
    # Captures HOW and WHY this number entered the system. Populated
    # once at ingestion time and treated as historical (do not mutate).

    ingestion_source: str = Field(
        nullable=False,
        description="Origin channel of this row (e.g. 'manual', 'automated').",
    )
    """
    Free-form string identifying how this number was surfaced.

    Example values (illustrative, NOT enforced):
        - "manual"     : entered by a human operator via the UI
        - "automated"  : surfaced by the IngestionEngine background job

    Internal engines may introduce additional source identifiers
    (e.g. "partner_feed_x") without schema changes.
    """

    ingestion_reason: Optional[str] = Field(
        default=None,
        description="Algorithmic justification or operator note for this ingestion.",
    )
    """
    Long-form text explaining WHY this number was ingested.

    For manual entries: the operator's note.
    For automated entries: the proprietary algorithm's natural-language
    rationale (often a serialised explanation of the scoring decision).

    Stored as TEXT — no length cap in SQLite. Add a length limit in
    production if your DB engine requires one.
    """

    ingested_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(UTCDateTime(), nullable=False),
        description="Tz-aware UTC timestamp when this number entered the pipeline.",
    )
    """Set once at insertion. Functionally equivalent to `created_at`
    but kept separately to preserve semantic clarity in queries."""

    # ==================================================================
    # PHASE 3 BLOCK — VERIFICATION & QUALITY DATA
    # ==================================================================
    # Captures the internal evaluation of the number's quality. Mutated
    # by the FeedbackChecker (background job) and/or by manual operator
    # review actions.

    verification_status: str = Field(
        default="pending",
        index=True,
        nullable=False,
        description="Quality assessment state (e.g. 'pending', 'verified_good', 'verified_bad').",
    )
    """
    Lifecycle state of the internal quality audit.

    Example values (illustrative, NOT enforced):
        - "pending"        : not yet evaluated
        - "verified_good"  : passed internal quality audit
        - "verified_bad"   : flagged as low-quality / non-actionable

    Indexed so the Review Queue UI can efficiently fetch all rows in a
    given state. Internal teams may introduce more granular states
    (e.g. "needs_manual_review") without schema changes.
    """

    verification_source: Optional[str] = Field(
        default=None,
        description="Origin of the verification verdict ('manual' / 'automated').",
    )
    """
    Identifies who or what produced the current `verification_status`.

    Example values (illustrative):
        - "manual"     : a human reviewer approved/rejected the row
        - "automated"  : the FeedbackChecker job set this verdict

    NULL while `verification_status` is "pending".
    """

    verification_reason: Optional[str] = Field(
        default=None,
        description="Explicit justification for the verification verdict.",
    )
    """
    Long-form text explaining WHY the number received its current
    `verification_status`. May be the reviewer's note (manual path) or
    the proprietary algorithm's natural-language explanation
    (automated path).
    """

    verified_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(UTCDateTime(), nullable=True),
        description="Tz-aware UTC timestamp of the most recent verification verdict.",
    )
    """Set when `verification_status` transitions out of "pending".
    NULL while still pending."""

    # ==================================================================
    # PHASE DY BLOCK — SCORING & PRIORITISATION
    # ==================================================================
    # confidence_score   : "How sure are we this number belongs to this entity?"
    # priority_score     : confidence × (α·relation_weight + β·tier_weight)
    # *_updated_at       : last write timestamp on each respective score.
    #
    # The actual formula and weight tables live in the injected
    # BaseScoringStrategy (see interfaces/scoring.py). This table stores
    # only the abstract floats — no business meaning leaks into the DB.

    confidence_score: float = Field(
        default=50.0,
        nullable=False,
        description=(
            "Reliability/validation score of the number, 0.0 → 100.0. "
            "Configured baseline on ingest; mutated by manual operator "
            "audit or by an automated reliability strategy."
        ),
    )
    """
    Stored as float for headroom in case the strategy outputs decimals
    (e.g. weighted averages). Acceptable range is convention-only —
    the column does not enforce 0..100 at the DB level so internal
    strategies can adopt different scales without a migration.
    """

    confidence_updated_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(UTCDateTime(), nullable=True),
        description=(
            "Tz-aware UTC timestamp of the most recent confidence_score "
            "write. NULL means the score is still at its insert default "
            "and has never been audited."
        ),
    )

    priority_score: float = Field(
        default=0.0,
        nullable=False,
        index=True,
        description=(
            "Final business urgency score driving the prioritised review "
            "queue. Computed by ScoringService from confidence + relation + "
            "tier inputs. Indexed because every /phones list page sorts "
            "DESC on this column (with NULLS LAST + id tiebreaker)."
        ),
    )
    """
    Stored (denormalised) rather than computed at query time. Trade-off:
    fast reads, eventually-consistent writes. ScoringService is the sole
    writer (via VerificationService, IngestionService, and PATCH /phones).

    Indexed so the priority-sorted list endpoint scales without a full
    table scan once row counts grow past the SQLite-dev range.
    """

    priority_updated_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(UTCDateTime(), nullable=True),
        description=(
            "Tz-aware UTC timestamp of the most recent priority_score "
            "write. NULL until ScoringService has run once."
        ),
    )

    # ==================================================================
    # METADATA & PROPRIETARY PAYLOAD
    # ==================================================================

    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(UTCDateTime(), nullable=False),
        description="Tz-aware UTC timestamp when this row was first inserted.",
    )

    updated_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(
            UTCDateTime(),
            nullable=False,
            onupdate=_utc_now,
        ),
        description="Tz-aware UTC timestamp of the most recent update (auto-managed).",
    )
    """
    Auto-refreshed by SQLAlchemy's `onupdate` hook on every UPDATE.
    Read-only at the application layer.
    """

    deleted_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(UTCDateTime(), nullable=True, index=True),
        description=(
            "Soft-delete tombstone (UAT round-3). NULL = active; non-NULL = "
            "soft-deleted. Cascade target when its owning Entity is soft-deleted."
        ),
    )

    # ------------------------------------------------------------------
    # Audit attribution (Phase AUTH)
    # ------------------------------------------------------------------

    uploaded_by_user_id: Optional[int] = Field(
        default=None,
        foreign_key="user.id",
        index=True,
        description=(
            "FK to the User who ingested this phone number. Nullable "
            "for legacy rows (ingested before Phase AUTH), guest-mode "
            "ingests, and automation-driven inserts. Populated by the "
            "ingestion endpoints (single + bulk-text + bulk-upload) "
            "when a logged-in user is present on the request. The "
            "personalization filter unions this with the client-based "
            "filter to surface 'phones I uploaded OR phones for my "
            "managed clients' to operators."
        ),
    )

    extra_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description="Opaque JSON bucket for proprietary ingestion/verification metadata.",
    )
    """
    Generic JSON container for sensitive runtime metadata produced by
    the IngestionEngine or FeedbackChecker.

    Example contents (illustrative, NOT enforced):
        {
            "scoring_breakdown": {...},
            "carrier_lookup": {...},
            "internal_audit_trail": [...]
        }

    Internal teams should treat this column as their exclusive sandbox
    for proprietary data. The open-source schema knows nothing about
    its structure.
    """
