"""
test_search_fda — openFDA approvals fetcher, from mocked responses.

Asserts the NDA/BLA label filter in the URL, de-duplication (biosimilars of one
active ingredient become one row), ONE batched drugsfda call, the approval date
taken from the ORIG+AP submission, newest-first order, and that api_key is sent
only when OPENFDA_API_KEY is set.
"""

from __future__ import annotations

import asyncio
import os
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sources.openfda import fetch_fda_approvals  # noqa: E402


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _label(brand, generic, app, maker="Maker"):
    return {"openfda": {
        "brand_name": [brand], "generic_name": [generic],
        "application_number": [app], "manufacturer_name": [maker],
    }}


_LABELS = {"results": [
    _label("RASONQUE", "DARAXONRASIB", "NDA220910", "Revolution"),
    _label("AVASTIN", "BEVACIZUMAB", "BLA125085"),
    _label("MVASI", "BEVACIZUMAB", "BLA761028"),       # biosimilar: same generic -> dropped
    _label("ZIRABEV", "bevacizumab", "BLA761099"),      # biosimilar, different case -> dropped
    _label("GEMZAR", "GEMCITABINE", "NDA020509"),
    _label("GENERIC", "ANDAONLY", "ANDA123456"),        # not NDA/BLA -> dropped
    {"openfda": {"brand_name": ["NOAPP"], "generic_name": ["noapp"]}},   # no application number
]}


def _sub(kind, status, date, priority=None):
    return {"submission_type": kind, "submission_status": status,
            "submission_status_date": date, "review_priority": priority}


_FDA = {"results": [
    {"application_number": "NDA220910", "sponsor_name": "REVOLUTION MEDICINES",
     "submissions": [_sub("SUPPL", "AP", "20270101"), _sub("ORIG", "AP", "20260826", "PRIORITY")]},
    {"application_number": "BLA125085", "sponsor_name": "GENENTECH",
     "submissions": [_sub("ORIG", "AP", "20040226", "PRIORITY")]},
    {"application_number": "BLA761028", "sponsor_name": "AMGEN",
     "submissions": [_sub("ORIG", "AP", "20170914")]},
    {"application_number": "BLA761099", "sponsor_name": "PFIZER",
     "submissions": [_sub("ORIG", "AP", "20190627")]},
    {"application_number": "NDA020509", "sponsor_name": "LILLY",
     "submissions": [_sub("ORIG", "TA", "19960515")]},   # ORIG but not AP -> no approval date -> dropped
]}


class _FakeClient:
    def __init__(self, labels=_LABELS, fda=_FDA):
        self._labels, self._fda = labels, fda
        self.urls: list[str] = []

    async def get(self, url, timeout=None, headers=None):
        self.urls.append(url)
        return _FakeResponse(self._labels if "label.json" in url else self._fda)


def _run(client=None, disease="pancreatic", cap=10):
    client = client or _FakeClient()
    return client, asyncio.run(fetch_fda_approvals(client, disease, cap))


def test_label_search_is_restricted_to_nda_and_bla():
    c, _ = _run()
    url = unquote(c.urls[0])
    assert "drug/label.json" in url and "limit=25" in url and "sort=effective_time:desc" in url
    assert "&search=indications_and_usage:pancreatic+AND+(" in url
    assert "openfda.application_number:NDA*" in url and "openfda.application_number:BLA*" in url


def test_indication_search_uses_meaningful_words_not_the_exact_phrase():
    from sources.openfda import _CANCER_GROUP, _indication_clause
    # a dropped cancer word becomes one more required group
    assert _indication_clause("pancreatic cancer") == f"indications_and_usage:(pancreatic+AND+{_CANCER_GROUP})"
    assert _indication_clause("idiopathic pulmonary fibrosis") == (
        "indications_and_usage:(idiopathic+AND+pulmonary+AND+fibrosis)"
    )
    assert _indication_clause("Alzheimer's disease") == "indications_and_usage:alzheimer"
    assert _indication_clause("Alzheimer’s disease") == "indications_and_usage:alzheimer"   # curly apostrophe
    assert _indication_clause("non-small cell lung cancer") == (
        f"indications_and_usage:(non+AND+small+AND+cell+AND+lung+AND+{_CANCER_GROUP})"
    )
    assert _indication_clause("pulmonary fibrosis") == "indications_and_usage:(pulmonary+AND+fibrosis)"
    assert _indication_clause("glioblastoma") == "indications_and_usage:glioblastoma"


def test_indication_search_falls_back_to_the_phrase_when_only_generic_words_remain():
    from sources.openfda import _indication_clause
    assert _indication_clause("cancer") == 'indications_and_usage:"cancer"'
    assert _indication_clause("Tumor of the disease") == 'indications_and_usage:"Tumor%20of%20the%20disease"'


def test_cancer_group_matches_all_the_cancer_wording():
    from sources.openfda import _CANCER_GROUP
    for w in ("cancer", "carcinoma", "adenocarcinoma", "tumor", "tumors", "neoplasm", "neoplasms",
              "malignant", "malignancy", "metastatic", "lymphoma", "leukemia", "sarcoma", "myeloma"):
        assert f"{w}+OR+" in _CANCER_GROUP or _CANCER_GROUP.endswith(f"{w})")


def test_label_url_for_a_cancer_search_requires_the_cancer_group():
    from sources.openfda import _CANCER_GROUP
    c, _ = _run(disease="pancreatic cancer")
    url = unquote(c.urls[0])
    assert f"&search=indications_and_usage:(pancreatic+AND+{_CANCER_GROUP})+AND+(openfda" in url


def test_biosimilars_collapse_to_the_originator_and_non_nda_bla_is_dropped():
    _, items = _run()
    generics = [i.raw["generic"] for i in items]
    assert generics.count("bevacizumab") == 1
    bev = next(i for i in items if i.raw["generic"] == "bevacizumab")
    assert bev.raw["brand"] == "AVASTIN" and bev.raw["approval_date"] == "20040226"   # earliest, not MVASI 2017
    assert "andaonly" not in generics and "noapp" not in generics


def test_avastin_and_suffixed_biosimilar_vegzelma_collapse_to_avastin():
    labels = {"results": [   # newest label first, as openFDA returns them
        _label("VEGZELMA", "bevacizumab-adcd", "BLA761231", "Celltrion"),
        _label("AVASTIN", "BEVACIZUMAB", "BLA125085", "Genentech"),
    ]}
    fda = {"results": [
        {"application_number": "BLA761231", "sponsor_name": "CELLTRION",
         "submissions": [_sub("ORIG", "AP", "20220927")]},
        {"application_number": "BLA125085", "sponsor_name": "GENENTECH",
         "submissions": [_sub("ORIG", "AP", "20040226", "PRIORITY")]},
    ]}
    _, items = _run(_FakeClient(labels=labels, fda=fda))
    assert [i.title for i in items] == ["AVASTIN (bevacizumab)"]
    assert items[0].raw["approval_date"] == "20040226"


def test_one_batched_drugsfda_call_for_all_applications():
    c, _ = _run()
    fda_urls = [u for u in c.urls if "drugsfda.json" in u]
    assert len(fda_urls) == 1 and len(c.urls) == 2
    url = unquote(fda_urls[0])
    assert "application_number:(NDA220910+OR+BLA125085+OR+BLA761028+OR+BLA761099+OR+NDA020509)" in url


def test_approval_date_comes_from_orig_ap_and_items_are_newest_first():
    _, items = _run()
    assert [i.raw["application_number"] for i in items] == ["NDA220910", "BLA125085"]
    first = items[0]
    assert first.raw["approval_date"] == "20260826"       # not the 2027 SUPPL
    assert first.raw["review_priority"] == "PRIORITY"
    assert first.date_iso == "2026-08-26T00:00:00.000Z"
    assert first.kind == "approval" and first.source == "openfda" and first.signal is None
    assert first.title == "RASONQUE (daraxonrasib)"
    assert first.summary == "REVOLUTION MEDICINES · FDA approved Aug 26, 2026"
    assert first.url == (
        "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=220910"
    )
    assert first.raw == {
        "brand": "RASONQUE", "generic": "daraxonrasib", "sponsor": "REVOLUTION MEDICINES",
        "application_number": "NDA220910", "approval_date": "20260826", "review_priority": "PRIORITY",
        "indication": None,   # the fixture label has no indications text
    }


def test_cap_limits_results():
    _, items = _run(cap=1)
    assert [i.raw["application_number"] for i in items] == ["NDA220910"]


def test_api_key_is_sent_only_when_set():
    old = os.environ.get("OPENFDA_API_KEY")
    try:
        os.environ.pop("OPENFDA_API_KEY", None)
        c, _ = _run()
        assert not any("api_key" in u for u in c.urls)

        os.environ["OPENFDA_API_KEY"] = ""          # empty must behave like unset
        c, _ = _run()
        assert not any("api_key" in u for u in c.urls)

        os.environ["OPENFDA_API_KEY"] = "secret123"
        c, _ = _run()
        assert len(c.urls) == 2 and all("api_key=secret123" in u for u in c.urls)
    finally:
        if old is None:
            os.environ.pop("OPENFDA_API_KEY", None)
        else:
            os.environ["OPENFDA_API_KEY"] = old


def test_no_label_matches_returns_empty_without_the_second_call():
    c = _FakeClient(labels={"results": []})
    _, items = _run(c)
    assert items == [] and len(c.urls) == 1


def test_explore_query_is_the_first_disease_only():
    from tools.explore import _query_for
    scope = {"diseases": ["pancreatic cancer", "glioblastoma"], "genes": ["KRAS"], "topics": [],
             "assets": [], "methods": []}
    assert _query_for("search_fda", scope) == "pancreatic cancer"
    assert _query_for("search_fda", {**scope, "diseases": []}) == ""


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for fn in fns:
        try:
            fn(); print(f"PASS  {fn.__name__}")
        except Exception as exc:
            failures += 1; print(f"FAIL  {fn.__name__}: {type(exc).__name__}: {exc}")
    print(f"\n{len(fns) - failures}/{len(fns)} passed")
    sys.exit(1 if failures else 0)
