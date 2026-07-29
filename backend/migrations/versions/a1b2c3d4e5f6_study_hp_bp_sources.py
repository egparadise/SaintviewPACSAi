"""study: 행잉 프로토콜 부위 매칭 대상 DICOM 컬럼 4종

부위(Body Part) 값이 어느 태그에 들어오는지는 장비·기관마다 다르다.
HP 규칙이 '어느 필드에서 부위를 찾을지' 고를 수 있도록 후보 태그를 저장한다.

Revision ID: a1b2c3d4e5f6
Revises: f5b6c7d8e9a0
"""

from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "f5b6c7d8e9a0"
branch_labels = None
depends_on = None

_COLS = [
    ("protocol_name", 128),   # (0018,1030) ProtocolName
    ("procedure_code", 128),  # (0008,1032) ProcedureCodeSequence — 코드값/의미 평탄화
    ("procedure_desc", 256),  # (0032,1060) RequestedProcedureDescription
    ("step_desc", 256),       # (0040,0254) PerformedProcedureStepDescription
]


def upgrade() -> None:
    for name, length in _COLS:
        op.add_column(
            "studies",
            sa.Column(name, sa.String(length=length), nullable=False, server_default=""),
        )


def downgrade() -> None:
    for name, _ in _COLS:
        op.drop_column("studies", name)
