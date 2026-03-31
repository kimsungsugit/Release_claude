from __future__ import annotations


def test_start_impact_job_completes_with_sync_thread(tmp_path, monkeypatch):
    from workflow.change_trigger import ChangeTrigger
    from workflow import impact_jobs

    monkeypatch.setattr(impact_jobs, "JOB_DIR", tmp_path / "jobs")

    # Mock run_impact_update so no real orchestration happens
    monkeypatch.setattr(
        impact_jobs,
        "run_impact_update",
        lambda trigger, options=None, on_progress=None: {
            "ok": True,
            "dry_run": trigger.dry_run,
            "trigger": trigger.to_dict(),
            "actions": {"uds": {"mode": "AUTO", "status": "completed"}},
        },
    )

    created = impact_jobs.start_impact_job(
        ChangeTrigger(
            trigger_type="local",
            scm_id="hdpdm01",
            source_root=str(tmp_path / "src"),
            scm_type="svn",
            base_ref="",
            changed_files=["Sources/APP/Ap_BuzzerCtrl_PDS.c"],
            dry_run=True,
            targets=["uds"],
            metadata={},
        )
    )

    # Wait for the background thread to finish (with timeout to prevent hang)
    job_id = created["job_id"]
    _wait_for_job(impact_jobs, job_id, timeout=10)

    loaded = impact_jobs.load_job(job_id)
    assert created["ok"] is True
    assert loaded["status"] == "completed"
    assert loaded["result"]["actions"]["uds"]["status"] == "completed"


def test_start_impact_job_without_changed_files_completes_cleanly(tmp_path, monkeypatch):
    from workflow.change_trigger import ChangeTrigger
    from workflow import impact_jobs

    monkeypatch.setattr(impact_jobs, "JOB_DIR", tmp_path / "jobs")

    created = impact_jobs.start_impact_job(
        ChangeTrigger(
            trigger_type="local",
            scm_id="hdpdm01",
            source_root=str(tmp_path / "src"),
            scm_type="svn",
            base_ref="",
            changed_files=[],
            dry_run=True,
            targets=["uds"],
            metadata={},
        )
    )

    job_id = created["job_id"]
    _wait_for_job(impact_jobs, job_id, timeout=10)

    loaded = impact_jobs.load_job(job_id)
    assert loaded["status"] == "completed"
    assert loaded["result"]["warnings"] == ["no changed files detected"]


def _wait_for_job(impact_jobs_mod, job_id: str, timeout: float = 10) -> None:
    """Poll job status until terminal, with a hard timeout to prevent hangs."""
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            job = impact_jobs_mod.load_job(job_id)
        except (KeyError, RuntimeError):
            # KeyError: file not created yet; RuntimeError: partial write / empty file
            time.sleep(0.05)
            continue
        if job.get("status") in {"completed", "failed"}:
            return
        time.sleep(0.05)
    raise TimeoutError(f"Job {job_id} did not complete within {timeout}s")
