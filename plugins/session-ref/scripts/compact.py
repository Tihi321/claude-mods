# Prints a Claude Code session transcript (.jsonl) cut down to what the
# session-ref mod digests: main-thread user and assistant rows, text trimmed,
# tool calls reduced to their file path or command. Used for transcripts too
# big for the mod to read whole (it reads files up to 4 MiB).
# Usage: python compact.py <transcript.jsonl>
import json
import sys

KEEP_INPUT = ("file_path", "notebook_path", "command")


def trim_block(block):
    kind = block.get("type")
    if kind == "text":
        return {"type": "text", "text": block.get("text", "")[:1500]}
    if kind == "tool_use":
        given = block.get("input") or {}
        kept = {k: (v[:2000] if isinstance(v, str) else v) for k, v in given.items() if k in KEEP_INPUT}
        return {"type": "tool_use", "name": block.get("name"), "input": kept}
    return None


def main(path):
    out = sys.stdout
    with open(path, encoding="utf-8", errors="replace") as lines:
        for line in lines:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("type") not in ("user", "assistant") or row.get("isSidechain"):
                continue
            content = (row.get("message") or {}).get("content")
            if isinstance(content, str):
                content = content[:1500]
            elif isinstance(content, list):
                content = [b for b in (trim_block(x) for x in content if isinstance(x, dict)) if b]
            else:
                continue
            out.write(json.dumps({
                "type": row["type"],
                "timestamp": row.get("timestamp"),
                "cwd": row.get("cwd"),
                "gitBranch": row.get("gitBranch"),
                "isMeta": row.get("isMeta"),
                "message": {"content": content},
            }, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
