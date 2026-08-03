"""시리즈 트리 후보 폴백 — **캐시가 폴백을 잡아먹으면 안 된다.**

배포에 따라 영상이 병원 전용 Orthanc 컨테이너에 있기도, 공용에 있기도 해서 후보가 여럿이다.
그런데 시리즈 트리 캐시의 키는 orthanc_id 하나뿐이다. 후보를 하나씩 캐시 함수로 돌리면
**첫 후보의 빈 결과가 캐시에 앉고**, 두 번째 후보 시도가 그 빈 값을 캐시 적중으로 돌려받는다.
그러면 영상을 실제로 가진 Orthanc 가 있는데도 반출이 **0장으로 조용히 끝난다** —
사용자는 "내보내기를 눌렀는데 아무것도 안 나온다" 로만 겪고, 서버에는 오류가 없다.

계약: 앞 후보가 비면 뒤 후보를 **캐시를 거치지 않고** 확인하고, 성공한 쪽으로 캐시를 덮는다.
"""
from __future__ import annotations

import pytest

from app.api import worklist as wl


class FakeOrthanc:
    """series_tree 만 흉내 내는 후보. calls 로 실제 조회 횟수를 센다."""

    def __init__(self, tree, name="x"):
        self._tree = tree
        self.name = name
        self.calls = 0

    def series_tree(self, _oid):
        self.calls += 1
        if isinstance(self._tree, Exception):
            raise self._tree
        return self._tree


SERIES = [{"series_uid": "1.2.3.1", "series_number": 1,
           "instances": [{"orthanc_id": "i1", "sop_uid": "s1", "instance_number": 1}]}]


@pytest.fixture(autouse=True)
def clean_cache():
    wl.invalidate_series_tree()
    yield
    wl.invalidate_series_tree()


def test_falls_back_to_the_orthanc_that_actually_has_it():
    """★ 핵심 회귀 방어 — 1번 후보가 비어도 2번 후보의 결과가 나와야 한다."""
    empty, real = FakeOrthanc([], "hospital"), FakeOrthanc(SERIES, "shared")

    got = wl.cached_series_tree_multi([empty, real], "oid-1")

    assert got == SERIES, "폴백이 캐시에 잡아먹혔다 — 반출이 0장이 된다"
    assert real.calls == 1


def test_successful_fallback_overwrites_the_cache():
    """폴백으로 찾은 결과가 캐시에 남아야 한다 — 안 그러면 매 요청 전 후보를 다시 훑는다.

    반출은 파일 한 장마다 이 경로를 지나므로(_entries), 캐시가 안 남으면 O(N) 왕복이 O(N²)가 된다.
    """
    empty, real = FakeOrthanc([], "hospital"), FakeOrthanc(SERIES, "shared")
    wl.cached_series_tree_multi([empty, real], "oid-2")

    again = wl.cached_series_tree_multi([empty, real], "oid-2")

    assert again == SERIES
    assert real.calls == 1, "캐시가 안 남아 2번 후보를 다시 물었다"
    assert empty.calls == 1, "캐시가 안 남아 1번 후보를 다시 물었다"


def test_first_candidate_wins_when_it_has_the_study():
    """정상 경로 — 1번 후보가 가지고 있으면 2번은 건드리지도 않는다."""
    real, other = FakeOrthanc(SERIES, "hospital"), FakeOrthanc(SERIES, "shared")

    got = wl.cached_series_tree_multi([real, other], "oid-3")

    assert got == SERIES
    assert other.calls == 0


def test_exception_on_first_candidate_is_not_fatal():
    """1번 후보가 죽어 있어도(연결 거부) 2번에서 찾으면 된다."""
    dead = FakeOrthanc(RuntimeError("connection refused"), "hospital")
    real = FakeOrthanc(SERIES, "shared")

    assert wl.cached_series_tree_multi([dead, real], "oid-4") == SERIES


def test_all_candidates_empty_returns_empty_and_does_not_raise():
    """어디에도 없으면 빈 목록 — 호출부가 '0장' 으로 처리한다(예외로 반출 전체를 죽이지 않는다)."""
    assert wl.cached_series_tree_multi([FakeOrthanc([]), FakeOrthanc([])], "oid-5") == []


def test_no_candidates_or_no_id_is_empty():
    assert wl.cached_series_tree_multi([], "oid-6") == []
    assert wl.cached_series_tree_multi([FakeOrthanc(SERIES)], "") == []
