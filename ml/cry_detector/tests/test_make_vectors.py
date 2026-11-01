"""The committed web vectors (code/web/src/cry/cryTriggerVectors.json) must be what trigger.py gives today."""

import json

from cry_detector.make_vectors import DEFAULT_OUT, build, main, render


def test_committed_vectors_are_up_to_date():
    assert DEFAULT_OUT.exists(), "run python -m cry_detector.make_vectors"
    assert DEFAULT_OUT.read_text(encoding="utf-8") == render(build()), "run python -m cry_detector.make_vectors"
    assert main(["--check"]) == 0


def test_vectors_cover_the_listed_situations():
    doc = json.loads(render(build()))
    by_name = {c["name"]: c for c in doc["cases"]}
    assert doc["hopSeconds"] == 0.975
    assert by_name["quiet"]["events"] == [] and by_name["short_spike"]["events"] == []
    assert len(by_name["one_cry"]["events"]) == 1
    assert len(by_name["two_cries_short_gap"]["events"]) == 1
    assert len(by_name["two_cries_long_gap"]["events"]) == 2
    assert by_name["cry_at_stream_end"]["events"][0]["closedByStreamEnd"]
    assert len(by_name["flapping"]["events"]) >= 1
    # A faint cry: caught at "more" and "balanced", missed at "less" (thresholds 0.01 / 0.02 / 0.03).
    assert [len(by_name[f"faint_cry_{lvl}"]["events"]) for lvl in ("more", "balanced", "less")] == [1, 1, 0]
    for case in doc["cases"]:
        assert len(case["scores"].split(" ")) == case["windows"]


def test_check_reports_a_stale_file(tmp_path):
    stale = tmp_path / "v.json"
    stale.write_text("{}\n", encoding="utf-8")
    assert main(["--check", "--out", str(stale)]) == 1
