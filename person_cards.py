import json
import logging
import os

from github import Github, GithubException, InputGitTreeElement

from db import get_all_person_cards

logger = logging.getLogger(__name__)

# Fields the user fills in manually; preserved across nightly compiles.
_USER_FIELDS = ("role", "company", "contact")
_PLACEHOLDER = "—"


def _parse_user_fields(content: str) -> dict[str, str]:
    """Extract user-managed optional fields from an existing card's frontmatter."""
    fields = {k: _PLACEHOLDER for k in _USER_FIELDS}
    in_front = False
    for line in content.splitlines():
        if line.strip() == "---":
            if not in_front:
                in_front = True
                continue
            break
        if in_front:
            for key in _USER_FIELDS:
                if line.startswith(f"{key}:"):
                    value = line[len(key) + 1:].strip()
                    if value:
                        fields[key] = value
    return fields


def _parse_notes_section(content: str) -> str:
    """Preserve the freeform ## Notes body the user may have written."""
    lines = content.splitlines()
    in_notes = False
    body: list[str] = []
    for line in lines:
        if line.strip() == "## Notes":
            in_notes = True
            continue
        if in_notes:
            if line.startswith("## "):
                break
            body.append(line)
    text = "\n".join(body).strip()
    return text if text else _PLACEHOLDER


def _card_markdown(card, user_fields: dict[str, str] | None = None, notes_body: str = _PLACEHOLDER) -> str:
    if user_fields is None:
        user_fields = {k: _PLACEHOLDER for k in _USER_FIELDS}
    log_lines = "\n".join(
        f"- **{n['date']}** — {n['context']}"
        for n in sorted(json.loads(card["notes_json"]), key=lambda x: x["date"])
    )
    role = user_fields.get("role", _PLACEHOLDER)
    company = user_fields.get("company", _PLACEHOLDER)
    contact = user_fields.get("contact", _PLACEHOLDER)
    return (
        f"---\n"
        f"name: {card['name']}\n"
        f"first_seen: {card['first_seen']}\n"
        f"last_seen: {card['last_seen']}\n"
        f"role: {role}\n"
        f"company: {company}\n"
        f"contact: {contact}\n"
        f"---\n\n"
        f"# {card['name']}\n\n"
        f"## Interaction Log\n"
        f"{log_lines}\n\n"
        f"## Notes\n"
        f"{notes_body}\n"
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

        # Preserve any user-edited fields from the existing card on GitHub.
        user_fields = None
        notes_body = _PLACEHOLDER
        try:
            existing = repo.get_contents(path, ref=branch)
            existing_text = existing.decoded_content.decode()
            user_fields = _parse_user_fields(existing_text)
            notes_body = _parse_notes_section(existing_text)
        except GithubException as exc:
            if exc.status != 404:
                raise

        content = _card_markdown(card, user_fields=user_fields, notes_body=notes_body)
        blob = repo.create_git_blob(content, "utf-8")
        blobs.append(InputGitTreeElement(path=path, mode="100644", type="blob", sha=blob.sha))

    new_tree = repo.create_git_tree(blobs, base_tree)
    new_commit = repo.create_git_commit(
        "people: update person cards",
        new_tree,
        [parent_commit],
    )
    ref.edit(new_commit.sha)
    logger.info("Committed %d person card(s)", len(blobs))
