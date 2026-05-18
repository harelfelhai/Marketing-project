"""
scripts/seed_db.py — Populate the database with representative demo data.

Creates a realistic dataset that covers all five client partitions and a
variety of entity/phone/action-log states so every UI screen has meaningful
content immediately after running this script.

USAGE
-----
    # From the backend/ directory with the virtualenv active:
    python scripts/seed_db.py

    # Wipe and re-seed (safe for dev; drops all rows before inserting):
    python scripts/seed_db.py --reset

WHAT GETS CREATED
-----------------
    Primary entities   : 5  (one per client partition, relation_type='primary')
    Associated entities: 7  (mixed across client partitions, relation_type='associated')
    Phone numbers      : 12 (one per entity + two extras on two primaries)
    Action logs        : 16 (mix of sent / failed / scheduled_retry / delivered)

CLIENT PARTITION MAP
--------------------
    The backend stores opaque integers only. Human-readable names live
    exclusively in the frontend `clientRegistry.js`.
    1 → Alpha   2 → Beta   3 → Gamma   4 → Delta   5 → Epsilon

GENERIC NOMENCLATURE INVARIANT
-------------------------------
    No proprietary campaign names, scoring values, or business-specific
    terminology appear in this file. Every label uses abstract terms.
    // HOOK FOR ENTERPRISE LABELS — swap display names in clientRegistry.js.
"""

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Allow running from the backend/ directory without installing the package.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlmodel import Session, select  # noqa: E402

from database import engine  # noqa: E402
from models.action_log import ActionLog  # noqa: E402
from models.entity import Entity  # noqa: E402
from models.phone_number import PhoneNumber  # noqa: E402
from models.pipeline_task import PipelineTask  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dt(days_ago: float = 0, hours_ago: float = 0) -> datetime:
    """Return a UTC datetime offset from now."""
    return datetime.utcnow() - timedelta(days=days_ago, hours=hours_ago)


def _wipe(session: Session) -> None:
    """Delete all rows in dependency order (FK constraints respected)."""
    # PipelineTask first — has FKs to both PhoneNumber and ActionLog.
    for task in session.exec(select(PipelineTask)).all():
        session.delete(task)
    for log in session.exec(select(ActionLog)).all():
        session.delete(log)
    for phone in session.exec(select(PhoneNumber)).all():
        session.delete(phone)
    # Associated entities first (have target_entity_id FK), then primaries.
    associated = [e for e in session.exec(select(Entity)).all() if e.target_entity_id is not None]
    primaries  = [e for e in session.exec(select(Entity)).all() if e.target_entity_id is None]
    for e in associated:
        session.delete(e)
    for e in primaries:
        session.delete(e)
    session.commit()
    print("  [reset] All existing rows deleted.")


# ---------------------------------------------------------------------------
# Seed data definitions
# ---------------------------------------------------------------------------

# Five primary entities — one per client partition.
# relation_type='primary': direct marketing targets.
PRIMARY_ENTITIES = [
    dict(client_id=1, relation_type="primary", entity_type="target",
         extra_data={"segment": "segment_a", "priority": "high"}),
    dict(client_id=2, relation_type="primary", entity_type="target",
         extra_data={"segment": "segment_b", "priority": "medium"}),
    dict(client_id=3, relation_type="primary", entity_type="target",
         extra_data={"segment": "segment_a", "priority": "high"}),
    dict(client_id=4, relation_type="primary", entity_type="target",
         extra_data={"segment": "segment_c", "priority": "low"}),
    dict(client_id=5, relation_type="primary", entity_type="target",
         extra_data={"segment": "segment_b", "priority": "medium"}),
]

# Phone numbers for primaries — indexed 0–4 matching PRIMARY_ENTITIES.
PRIMARY_PHONES = [
    dict(phone_number="+14155550101", classification_type="type_a",
         verification_status="verified_good", verification_source="manual",
         verification_reason="Confirmed via outbound callback.",
         ingestion_source="manual", ingestion_reason="Initial target import.",
         ingested_at=_dt(days_ago=30), verified_at=_dt(days_ago=28)),

    dict(phone_number="+14155550201", classification_type="type_b",
         verification_status="pending", verification_source=None,
         verification_reason=None,
         ingestion_source="automated", ingestion_reason="Automated pipeline import.",
         ingested_at=_dt(days_ago=20), verified_at=None),

    dict(phone_number="+14155550301", classification_type="type_a",
         verification_status="verified_bad", verification_source="automated",
         verification_reason="Unreachable after 3 attempts.",
         ingestion_source="manual", ingestion_reason="Operator referral.",
         ingested_at=_dt(days_ago=15), verified_at=_dt(days_ago=12)),

    dict(phone_number="+14155550401", classification_type="type_c",
         verification_status="pending", verification_source=None,
         verification_reason=None,
         ingestion_source="automated", ingestion_reason=None,
         ingested_at=_dt(days_ago=10), verified_at=None),

    dict(phone_number="+14155550501", classification_type="type_d",
         verification_status="verified_good", verification_source="manual",
         verification_reason="Active number confirmed.",
         ingestion_source="manual", ingestion_reason="Priority target.",
         ingested_at=_dt(days_ago=25), verified_at=_dt(days_ago=22)),
]

# Seven associated entities — perimeter contacts linked to primaries.
# relation_type='associated': circle-of-trust members.
# (target_entity_id assigned after primaries are inserted)
ASSOCIATED_SPEC = [
    # (primary_index, client_id, entity_type, extra_data)
    (0, 1, "family",  {"relationship": "immediate"}),
    (0, 1, "friend",  {"relationship": "close"}),
    (1, 2, "family",  {"relationship": "immediate"}),
    (2, 3, "colleague", {"relationship": "work"}),
    (2, 3, "friend",  {"relationship": "close"}),
    (3, 4, "family",  {"relationship": "extended"}),
    (4, 5, "friend",  {"relationship": "close"}),
]

ASSOCIATED_PHONES = [
    dict(phone_number="+14155550102", classification_type="type_b",
         verification_status="pending", verification_source=None,
         verification_reason=None,
         ingestion_source="automated", ingestion_reason="Circle member of primary target.",
         ingested_at=_dt(days_ago=29), verified_at=None),

    dict(phone_number="+14155550103", classification_type="type_a",
         verification_status="verified_good", verification_source="manual",
         verification_reason="Answered and confirmed.",
         ingestion_source="manual", ingestion_reason="Close contact referral.",
         ingested_at=_dt(days_ago=27), verified_at=_dt(days_ago=25)),

    dict(phone_number="+14155550202", classification_type="type_c",
         verification_status="verified_bad", verification_source="automated",
         verification_reason="Disconnected line.",
         ingestion_source="automated", ingestion_reason=None,
         ingested_at=_dt(days_ago=18), verified_at=_dt(days_ago=16)),

    dict(phone_number="+14155550302", classification_type="type_b",
         verification_status="pending", verification_source=None,
         verification_reason=None,
         ingestion_source="automated", ingestion_reason="Algorithmic match.",
         ingested_at=_dt(days_ago=14), verified_at=None),

    dict(phone_number="+14155550303", classification_type="type_a",
         verification_status="pending", verification_source=None,
         verification_reason=None,
         ingestion_source="manual", ingestion_reason="Operator flagged.",
         ingested_at=_dt(days_ago=13), verified_at=None),

    dict(phone_number="+14155550402", classification_type="type_d",
         verification_status="verified_good", verification_source="manual",
         verification_reason="Active — callback successful.",
         ingestion_source="manual", ingestion_reason="Priority circle member.",
         ingested_at=_dt(days_ago=9), verified_at=_dt(days_ago=7)),

    dict(phone_number="+14155550502", classification_type="type_b",
         verification_status="pending", verification_source=None,
         verification_reason=None,
         ingestion_source="automated", ingestion_reason=None,
         ingested_at=_dt(days_ago=8), verified_at=None),
]

# Action log specs: (phone_index_in_all_phones, action_type, status, hours_ago_requested, extra_data)
# all_phones order: 5 primaries first, then 7 associated.
ACTION_LOG_SPECS = [
    # Primary 0 (phone idx 0) — delivered, then a follow-up sent
    (0, "action_type_a", "delivered", 29.0, {"result": "contact_made", "operator_id": "mock_operator_01"}),
    (0, "action_type_b", "sent",      27.0, {"operator_id": "mock_operator_01"}),

    # Primary 1 (phone idx 1) — failed with retries
    (1, "action_type_a", "failed",    19.5, {
        "error_detail": "Provider rejected: number temporarily out of service.",
        "stack_trace":  "ActionDispatcher.dispatch() → ProviderClient.send() → ProviderError: 503",
        "retry_count":  2,
    }),
    (1, "action_type_a", "scheduled_retry", 19.0, {"scheduled_by": "retry_engine"}),

    # Primary 2 (phone idx 2) — sent then failed
    (2, "action_type_b", "sent",       14.5, {"operator_id": "mock_operator_01"}),
    (2, "action_type_a", "failed",     12.0, {
        "error_detail": "Timeout waiting for delivery confirmation.",
        "stack_trace":  "ActionDispatcher.dispatch() → ProviderClient.send() → TimeoutError: 30s exceeded",
        "retry_count":  1,
    }),

    # Primary 4 (phone idx 4) — delivered clean
    (4, "action_type_a", "delivered",  24.0, {"result": "contact_made", "operator_id": "mock_operator_01"}),

    # Associated 0 → phone idx 5 — failed, awaiting retry
    (5, "action_type_a", "failed",     28.0, {
        "error_detail": "Invalid number format returned by provider.",
        "stack_trace":  "ActionDispatcher.dispatch() → ProviderClient.validate() → ValidationError",
        "retry_count":  0,
    }),
    (5, "action_type_a", "scheduled_retry", 27.5, {"scheduled_by": "retry_engine"}),

    # Associated 1 → phone idx 6 — delivered
    (6, "action_type_b", "delivered",  26.0, {"result": "contact_made"}),

    # Associated 2 → phone idx 7 — sent
    (7, "action_type_a", "sent",       17.0, {"operator_id": "mock_operator_01"}),

    # Associated 3 → phone idx 8 — failed twice
    (8, "action_type_b", "failed",     13.5, {
        "error_detail": "Account quota exceeded for this action type.",
        "stack_trace":  "ActionDispatcher.dispatch() → QuotaExceededError: daily limit reached",
        "retry_count":  1,
    }),

    # Associated 4 → phone idx 9 — pending
    (9, "action_type_a", "sent",       12.5, {}),

    # Associated 5 → phone idx 10 — delivered
    (10, "action_type_b", "delivered", 8.5, {"result": "voicemail_left"}),

    # Associated 6 → phone idx 11 — failed
    (11, "action_type_a", "failed",    7.5, {
        "error_detail": "Carrier intercept — number has been reassigned.",
        "stack_trace":  "ActionDispatcher.dispatch() → ProviderClient.send() → CarrierError: reassigned",
        "retry_count":  0,
    }),
    (11, "action_type_a", "scheduled_retry", 7.0, {"scheduled_by": "retry_engine"}),
]


# ---------------------------------------------------------------------------
# Main seed routine
# ---------------------------------------------------------------------------

def seed(reset: bool = False) -> None:
    """Run the full seed sequence."""
    from sqlmodel import SQLModel
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        if reset:
            _wipe(session)

        # ----------------------------------------------------------------
        # 1. Primary entities
        # ----------------------------------------------------------------
        print("  Inserting primary entities …")
        primary_records: list[Entity] = []
        for spec in PRIMARY_ENTITIES:
            entity = Entity(
                client_id=spec["client_id"],
                relation_type=spec["relation_type"],
                entity_type=spec["entity_type"],
                target_entity_id=None,
                extra_data=spec["extra_data"],
                created_at=_dt(days_ago=35),
                updated_at=_dt(days_ago=35),
            )
            session.add(entity)
            session.flush()
            primary_records.append(entity)
        print(f"    → {len(primary_records)} primary entities created.")

        # ----------------------------------------------------------------
        # 2. Primary phone numbers
        # ----------------------------------------------------------------
        print("  Inserting primary phone numbers …")
        phone_records: list[PhoneNumber] = []
        for entity, spec in zip(primary_records, PRIMARY_PHONES):
            phone = PhoneNumber(
                entity_id=entity.id,
                phone_number=spec["phone_number"],
                classification_type=spec["classification_type"],
                verification_status=spec["verification_status"],
                verification_source=spec.get("verification_source"),
                verification_reason=spec.get("verification_reason"),
                ingestion_source=spec["ingestion_source"],
                ingestion_reason=spec.get("ingestion_reason"),
                ingested_at=spec["ingested_at"],
                verified_at=spec.get("verified_at"),
                created_at=spec["ingested_at"],
                updated_at=spec.get("verified_at") or spec["ingested_at"],
            )
            session.add(phone)
            session.flush()
            phone_records.append(phone)
        print(f"    → {len(phone_records)} primary phone numbers created.")

        # ----------------------------------------------------------------
        # 3. Associated entities
        # ----------------------------------------------------------------
        print("  Inserting associated entities …")
        associated_records: list[Entity] = []
        for primary_idx, client_id, entity_type, extra in ASSOCIATED_SPEC:
            target_id = primary_records[primary_idx].id
            entity = Entity(
                client_id=client_id,
                relation_type="associated",
                entity_type=entity_type,
                target_entity_id=target_id,
                extra_data=extra,
                created_at=_dt(days_ago=28),
                updated_at=_dt(days_ago=28),
            )
            session.add(entity)
            session.flush()
            associated_records.append(entity)
        print(f"    → {len(associated_records)} associated entities created.")

        # ----------------------------------------------------------------
        # 4. Associated phone numbers
        # ----------------------------------------------------------------
        print("  Inserting associated phone numbers …")
        for entity, spec in zip(associated_records, ASSOCIATED_PHONES):
            phone = PhoneNumber(
                entity_id=entity.id,
                phone_number=spec["phone_number"],
                classification_type=spec["classification_type"],
                verification_status=spec["verification_status"],
                verification_source=spec.get("verification_source"),
                verification_reason=spec.get("verification_reason"),
                ingestion_source=spec["ingestion_source"],
                ingestion_reason=spec.get("ingestion_reason"),
                ingested_at=spec["ingested_at"],
                verified_at=spec.get("verified_at"),
                created_at=spec["ingested_at"],
                updated_at=spec.get("verified_at") or spec["ingested_at"],
            )
            session.add(phone)
            session.flush()
            phone_records.append(phone)
        print(f"    → {len(phone_records)} total phone numbers after associated batch.")

        # ----------------------------------------------------------------
        # 5. Action logs
        # ----------------------------------------------------------------
        print("  Inserting action logs …")
        log_records: list[ActionLog] = []
        for phone_idx, action_type, log_status, hours_ago, extra in ACTION_LOG_SPECS:
            requested = _dt(hours_ago=hours_ago)
            executed  = requested + timedelta(minutes=2) if log_status != "scheduled_retry" else None
            retry_after = (
                datetime.utcnow() + timedelta(hours=2)
                if log_status == "scheduled_retry"
                else None
            )
            log = ActionLog(
                phone_id=phone_records[phone_idx].id,
                action_type=action_type,
                status=log_status,
                requested_at=requested,
                executed_at=executed,
                retry_count=extra.pop("retry_count", 0),
                retry_after=retry_after,
                extra_data=extra if extra else None,
                created_at=requested,
                updated_at=executed or requested,
            )
            session.add(log)
            session.flush()
            log_records.append(log)
        session.commit()
        print(f"    → {len(log_records)} action logs created.")

        # ----------------------------------------------------------------
        # 6. Pipeline tasks (Phase DX)
        # ----------------------------------------------------------------
        # Five representative tasks covering the three task_type tokens and
        # the four lifecycle statuses, so the OperationsQueue UI has data
        # to render across every filter sub-view.
        print("  Inserting pipeline tasks …")
        task_specs = [
            # Automated hand-off: phone 1's failed action awaits human review.
            dict(
                phone_idx=1, source_log_idx=2, task_type="remediation_failure",
                status="pending", requested_by="automation:retry_engine",
                resolved_by=None, hours_ago=18.0,
                extra={
                    "failure_category": "provider_blocked",
                    "suggested_remediation": "Escalate to carrier for unblock review.",
                },
            ),
            # Automated hand-off: phone 8's quota-exceeded failure.
            dict(
                phone_idx=8, source_log_idx=10, task_type="remediation_failure",
                status="assigned", requested_by="automation:retry_engine",
                resolved_by=None, hours_ago=12.0,
                extra={
                    "failure_category": "quota_exceeded",
                    "suggested_remediation": "Retry tomorrow after quota reset.",
                },
            ),
            # Operator request: low-tier operator asking for a Senior Admin to
            # authorize a manual action against phone 4.
            dict(
                phone_idx=4, source_log_idx=None, task_type="approval_required",
                status="pending", requested_by="mock_operator_02",
                resolved_by=None, hours_ago=6.0,
                extra={
                    "requested_action_type": "action_type_b",
                    "operator_note": "Customer requested call-back outside of normal cadence.",
                },
            ),
            # Pipeline suggestion: phone 9 surfaced as a verification candidate.
            dict(
                phone_idx=9, source_log_idx=None, task_type="manual_recommendation",
                status="resolved", requested_by="automation:verification_engine",
                resolved_by="mock_admin_01", hours_ago=4.0,
                extra={
                    "recommendation": "Flag for manual quality review.",
                    "resolution_outcome": "resolved",
                    "resolved_by": "mock_admin_01",
                    "resolution_note": "Confirmed reachable; marked verified_good.",
                },
            ),
            # Operator request that was rejected by the admin.
            dict(
                phone_idx=11, source_log_idx=14, task_type="approval_required",
                status="rejected", requested_by="mock_operator_02",
                resolved_by="mock_admin_01", hours_ago=2.0,
                extra={
                    "requested_action_type": "action_type_a",
                    "operator_note": "One more retry attempt before abandoning.",
                    "resolution_outcome": "rejected",
                    "resolved_by": "mock_admin_01",
                    "resolution_note": "Carrier intercept is permanent; do not retry.",
                },
            ),
        ]

        task_count = 0
        for spec in task_specs:
            requested = _dt(hours_ago=spec["hours_ago"])
            resolved_at = (
                requested + timedelta(hours=1)
                if spec["status"] in {"resolved", "rejected"}
                else None
            )
            task = PipelineTask(
                phone_id=phone_records[spec["phone_idx"]].id,
                source_action_log_id=(
                    log_records[spec["source_log_idx"]].id
                    if spec["source_log_idx"] is not None
                    else None
                ),
                task_type=spec["task_type"],
                status=spec["status"],
                requested_by=spec["requested_by"],
                resolved_by=spec["resolved_by"],
                created_at=requested,
                updated_at=resolved_at or requested,
                resolved_at=resolved_at,
                extra_data=spec["extra"],
            )
            session.add(task)
            task_count += 1
        session.commit()
        print(f"    → {task_count} pipeline tasks created.")

        print()
        print("  Seed complete.")
        print(f"    Entities      : {len(primary_records)} primary + {len(associated_records)} associated")
        print(f"    Phones        : {len(phone_records)}")
        print(f"    Action logs   : {len(log_records)}")
        print(f"    Pipeline tasks: {task_count}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed the marketing automation database.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Wipe all existing rows before seeding (safe for dev environments).",
    )
    args = parser.parse_args()

    print(f"Starting seed {'(with reset) ' if args.reset else ''}…")
    seed(reset=args.reset)
