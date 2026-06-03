"""
scripts/seed_large.py — Large-scale deterministic seed for performance testing.

Mirrors the frontend mock data exactly (same Mulberry32 PRNG, same seed
0x1a2b3c4d) so mock-mode and real-API-mode show identical data.

Scale:
    100  root entities  (relation_type='primary')
    900  member entities (9 per root, mixed relation types)
    2500 phones          (ph mapping: phone i → entity ((i-1) % 1000 + 1))
    200  tasks

USAGE
-----
    # From the backend/ directory:
    python scripts/seed_large.py           # append to existing data
    python scripts/seed_large.py --reset   # wipe then re-seed

This script is idempotent when run with --reset; running it without --reset
multiple times will duplicate data.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlmodel import Session, select  # noqa: E402

import models  # noqa: F401, E402 — register all tables before create_all
from database import engine, create_db_and_tables  # noqa: E402
from models.entity import Entity  # noqa: E402
from models.phone_number import PhoneNumber  # noqa: E402
from models.pipeline_task import PipelineTask  # noqa: E402
from models.types import SOFT_DELETE_SENTINEL  # noqa: E402


# ---------------------------------------------------------------------------
# Mulberry32 PRNG — identical to the frontend mock implementation.
# Fixed seed 0x1a2b3c4d ensures real-mode data matches mock-mode data exactly.
# ---------------------------------------------------------------------------

def _mulberry32(seed: int):
    s = seed & 0xFFFFFFFF

    def _next() -> float:
        nonlocal s
        s = (s + 0x6D2B79F5) & 0xFFFFFFFF
        t = (s ^ (s >> 15)) & 0xFFFFFFFF
        t = (t * (1 | s)) & 0xFFFFFFFF
        t = (t ^ ((t ^ (t >> 7)) * (61 | t))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return _next


_NOW = datetime(2026, 5, 17, 10, 0, 0, tzinfo=timezone.utc)


def _days_ago(d: float) -> datetime:
    from datetime import timedelta
    return _NOW - timedelta(days=d)


# ---------------------------------------------------------------------------
# Vocabulary tables — must match frontend mockData.js exactly.
# ---------------------------------------------------------------------------

_BASES    = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa']
_TYPES    = ['Solutions','Corp','Tech','Group','Systems','Capital','Labs','Media','Digital','Finance']
_FIRSTS   = ['יוסי','מיכל','דני','תמר','אבי','רחל','עמי','לאה','גיל','נועה',
             'ארי','שרה','רון','מאיה','עופר','דינה','יוני','כרמל','מתן','הילה']
_LASTS    = ['כהן','לוי','מזרחי','פרץ','ביטון','אברהם','גבאי','אשכנזי','שפירא',
             'רוזן','עמר','דהן','חיים','סבג','צרפתי','בן-דוד','נחמני','קדוש','הרוש','בר-לב']
_ROLES    = ['מנכ"ל','סמנכ"ל כספים','מנהל בכיר','שותף מנהל','מייסד ומנכ"ל',
             'יו"ר','מנהל פעילות','מנהל שיווק','מנהל מכירות','מנהל טכנולוגיה']
_REGIONS  = ['north','south','east','west','center']
_RELTYPES = ['family','friend','colleague','spouse','associated']
_PTYPES   = ['mobile','work','home','type_a','type_b']
_SOURCES  = ['api','manual','import','partner_feed']
_VSTATS   = ['pending','verified','rejected']
_TTYPES   = ['remediation_failure','approval_required','manual_recommendation']
_TSTATS   = ['pending','pending','done','rejected']   # 50% pending bias
_SLA_HRS  = [4, 6, 8, 12]


def _company_of(i: int) -> str:
    return f"{_BASES[i % 10]} {_TYPES[(i // 10) % 10]}"


# ---------------------------------------------------------------------------
# Wipe helpers
# ---------------------------------------------------------------------------

def _wipe(session: Session) -> None:
    print("  [reset] wiping existing rows…")
    for task in session.exec(select(PipelineTask)).all():
        session.delete(task)
    session.flush()

    for phone in session.exec(select(PhoneNumber)).all():
        session.delete(phone)
    session.flush()

    members  = [e for e in session.exec(select(Entity)).all() if e.target_entity_id is not None]
    primaries = [e for e in session.exec(select(Entity)).all() if e.target_entity_id is None]
    for e in members:
        session.delete(e)
    session.flush()
    for e in primaries:
        session.delete(e)
    session.commit()
    print("  [reset] done.")


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------

def seed(reset: bool = False) -> None:
    create_db_and_tables()
    rng  = _mulberry32(0x1A2B3C4D)
    pick = lambda arr: arr[int(rng() * len(arr))]
    rn   = lambda lo, hi: lo + int(rng() * (hi - lo + 1))

    with Session(engine) as session:
        if reset:
            _wipe(session)

        # ── Root entities (100) ──────────────────────────────────────
        # Predictable string ids (ent-1 … ent-100) so the frontend's
        # CLIENT_REGISTRY references and mock-mode entity ids line up
        # with the real-API rows.
        print("  seeding 100 root entities…")
        root_ids: list[str] = []
        for i in range(1, 101):
            company = _company_of(i - 1)
            tier    = (i % 3) + 1
            sla_hrs = _SLA_HRS[i % 4]
            eid     = f"ent-{i}"
            root_ids.append(eid)
            session.add(Entity(
                id=eid,
                relation_type='primary',
                target_entity_id=None,
                full_name=company,
                identifier_1=f"IL-{str(i).zfill(3)}",
                deleted_at=SOFT_DELETE_SENTINEL,
                extra_data={
                    'region':        pick(_REGIONS),
                    'role':          f"{pick(_ROLES)}, {company}",
                    'customer_tier': tier,
                    'sla_hours':     sla_hrs,
                    'sla_threshold_pct': 75 + (i % 16),
                },
            ))
        session.commit()  # commit after roots so member FKs resolve

        # ── Member entities (900 = 100 roots × 9 members) ────────────
        print("  seeding 900 member entities…")
        entity_id_by_num: dict[int, str] = {
            i + 1: root_ids[i] for i in range(100)
        }

        batch_size = 50
        for r in range(1, 101):
            root_id = root_ids[r - 1]
            for m in range(9):
                e_num = 100 + (r - 1) * 9 + m + 1
                has_id1 = rng() > 0.6
                has_id2 = rng() > 0.8
                eid = f"ent-{e_num}"
                entity_id_by_num[e_num] = eid
                session.add(Entity(
                    id=eid,
                    relation_type=pick(_RELTYPES),
                    target_entity_id=root_id,
                    full_name=f"{pick(_FIRSTS)} {pick(_LASTS)}",
                    identifier_1=f"ID-{str(e_num).zfill(4)}" if has_id1 else None,
                    identifier_2=f"P{e_num}-{rn(1000, 9999)}" if has_id2 else None,
                    deleted_at=SOFT_DELETE_SENTINEL,
                    extra_data={'region': pick(_REGIONS)},
                ))
            # Commit every root group to avoid large batches in executemany
            if r % 10 == 0:
                session.commit()
        session.commit()

        # ── Phones (2500) ────────────────────────────────────────────
        print("  seeding 2500 phones…")
        phone_id_by_num: dict[int, str] = {}
        for idx in range(2500):
            i            = idx + 1
            entity_num   = ((i - 1) % 1000) + 1
            entity_db_id = entity_id_by_num[entity_num]
            pid = f"ph-{i}"
            phone_id_by_num[i] = pid
            session.add(PhoneNumber(
                id=pid,
                entity_id=entity_db_id,
                phone_number=f"+1555{str(i).zfill(7)}",
                phone_type=pick(_PTYPES),
                ingestion_source=pick(_SOURCES),
                verification_status=pick(_VSTATS),
                score=round(rng() * 100) / 100,
                deleted_at=SOFT_DELETE_SENTINEL,
                extra_data={},
            ))
            if i % 250 == 0:
                session.commit()
        session.commit()

        # ── Tasks (200) ──────────────────────────────────────────────
        print("  seeding 200 tasks…")
        for idx in range(200):
            i            = idx + 1
            entity_num   = ((i - 1) % 1000) + 1
            entity_db_id = entity_id_by_num[entity_num]
            phone_db_id  = phone_id_by_num[i]
            session.add(PipelineTask(
                id=f"task-{i}",
                phone_id=phone_db_id,
                phone_number=f"+1555{str(i).zfill(7)}",
                entity_id=entity_db_id,
                task_type=pick(_TTYPES),
                status=pick(_TSTATS),
                deleted_at=SOFT_DELETE_SENTINEL,
                extra_data={},
            ))
            if i % 50 == 0:
                session.commit()
        session.commit()
        print("  done.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed the DB with large-scale deterministic data (mirrors frontend mock)."
    )
    parser.add_argument(
        '--reset', action='store_true',
        help='Wipe all existing rows before seeding.',
    )
    args = parser.parse_args()

    print(f"Starting large-scale seed {'(with reset) ' if args.reset else ''}…")
    seed(reset=args.reset)
    print("Large-scale seed complete: 100 roots, 900 members, 2500 phones, 200 tasks.")


if __name__ == '__main__':
    main()
