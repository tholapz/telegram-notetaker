import json
import logging
import os

from github import Github

from db import get_all_person_cards

logger = logging.getLogger(__name__)


def _card_markdown(card) -> str:
    notes = sorted(json.loads(card["notes_json"]), key=lambda x: x["date"])
    log_lines = "\n".join(f"- **{n['date']}** — {n['context']}" for n in notes)
    return (
        f"---\n"
        f"name: {card['name']}\n"
        f"first_seen: {card['first_seen']}\n"
        f"last_seen: {card['last_seen']}\n"
        f"---\n\n"
        f"# {card['name']}\n\n"
        f"## Interaction Log\n"
        f"{log_lines}\n"
    )


def compile_person_cards() -> None:
    cards = get_all_person_cards()
    if not cards:
        return

    vault_path = os.environ.get("GITHUB_VAULT_PATH", "Notes")
    branch = os.environ.get("GITHUB_BRANCH", "main")
    g = Github(os.environ["GITHUB_TOKEN"])
    repo = g.get_repo(os.environ["GITHUB_REPO"])

    ref = repo.get_git_ref(f"heads/{branch}")
    parent_commit = repo.get_git_commit(ref.object.sha)
    base_tree = parent_commit.tree

    blobs = []
    for card in cards:
        safe_name = card["name"].replace(" ", "-")
        path = f"{vault_path}/People/{safe_name}.md"
        blob = repo.create_git_blob(_card_markdown(card), "utf-8")
        blobs.append({"path": path, "mode": "100644", "type": "blob", "sha": blob.sha})

    new_tree = repo.create_git_tree(blobs, base_tree)
    new_commit = repo.create_git_commit(
        "people: update person cards",
        new_tree,
        [parent_commit],
    )
    ref.edit(new_commit.sha)
    logger.info("Committed %d person card(s)", len(blobs))
