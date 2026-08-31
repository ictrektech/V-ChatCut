#!/usr/bin/env python3
"""Read and update V-ChatCut image records in the shared Feishu sheet."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_SPREADSHEET_TOKEN = "Htotsn3oahO1zxt73YMcaB1zn8e"
API_ROOT = "https://open.feishu.cn/open-apis"


def fail(message: str) -> None:
    raise SystemExit(message)


def cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("text") or value.get("link") or "").strip()
    if isinstance(value, list):
        return "".join(cell_text(item) for item in value).strip()
    return str(value).strip()


def column_letter(number: int) -> str:
    output = ""
    while number > 0:
        number, remainder = divmod(number - 1, 26)
        output = chr(ord("A") + remainder) + output
    return output


def load_credentials() -> tuple[str, str]:
    env_id = os.environ.get("FEISHU_APP_ID", "").strip()
    env_secret = os.environ.get("FEISHU_APP_SECRET", "").strip()
    if env_id and env_secret:
        return env_id, env_secret

    candidates = [
        os.environ.get("FEISHU_CONFIG_FILE", ""),
        str(Path.home() / ".feishu.components.json"),
        str(Path.home() / ".feishu.json"),
    ]
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        path = Path(candidate)
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        app_id = str(data.get("feishu_app_id") or "").strip()
        app_secret = str(data.get("feishu_app_secret") or "").strip()
        if app_id and app_secret:
            return app_id, app_secret
    fail("Feishu credentials were not found in the environment or configured files")


class FeishuSheets:
    def __init__(self, spreadsheet_token: str) -> None:
        self.spreadsheet_token = spreadsheet_token
        app_id, app_secret = load_credentials()
        response = self.request(
            "POST",
            f"{API_ROOT}/auth/v3/tenant_access_token/internal",
            {"app_id": app_id, "app_secret": app_secret},
            authenticated=False,
        )
        self.token = str(response.get("tenant_access_token") or "")
        if not self.token:
            fail("Feishu token response did not include tenant_access_token")

    def request(
        self,
        method: str,
        url: str,
        body: dict[str, Any] | None = None,
        *,
        authenticated: bool = True,
    ) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Authorization"] = f"Bearer {self.token}"
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            fail(f"Feishu request failed: {method} {url}: {exc}")
        if result.get("code") != 0:
            fail(f"Feishu API error: {result}")
        return result

    def sheet_id(self, title: str) -> str:
        result = self.request(
            "GET",
            f"{API_ROOT}/sheets/v3/spreadsheets/{self.spreadsheet_token}/sheets/query",
        )
        for sheet in result.get("data", {}).get("sheets", []):
            if sheet.get("title") == title:
                return str(sheet["sheet_id"])
        fail(f"Feishu sheet not found: {title}")

    def values(self, cell_range: str) -> list[list[Any]]:
        encoded_range = urllib.parse.quote(cell_range, safe="!:" )
        result = self.request(
            "GET",
            f"{API_ROOT}/sheets/v2/spreadsheets/{self.spreadsheet_token}/values/{encoded_range}",
        )
        return result.get("data", {}).get("valueRange", {}).get("values", [])

    def write_cell(self, sheet_id: str, cell: str, value: str) -> None:
        self.request(
            "PUT",
            f"{API_ROOT}/sheets/v2/spreadsheets/{self.spreadsheet_token}/values",
            {"valueRange": {"range": f"{sheet_id}!{cell}:{cell}", "values": [[value]]}},
        )

    def component_column(self, sheet_id: str, component: str, create: bool) -> str:
        rows = self.values(f"{sheet_id}!A1:ZZ2")
        header = rows[0] if rows else []
        repository_row = rows[1] if len(rows) > 1 else []
        for index, value in enumerate(header, start=1):
            if cell_text(value) == component:
                return column_letter(index)
        if not create:
            fail(f"component column not found: {component}")

        last_used = 1
        for row in (header, repository_row):
            for index, value in enumerate(row, start=1):
                if cell_text(value):
                    last_used = max(last_used, index)

        metadata = self.request(
            "GET",
            f"{API_ROOT}/sheets/v3/spreadsheets/{self.spreadsheet_token}/sheets/query",
        )
        column_count = 0
        for sheet in metadata.get("data", {}).get("sheets", []):
            if sheet.get("sheet_id") == sheet_id:
                column_count = int(sheet.get("grid_properties", {}).get("column_count", 0))
                break
        if last_used >= column_count:
            self.request(
                "POST",
                f"{API_ROOT}/sheets/v2/spreadsheets/{self.spreadsheet_token}/dimension_range",
                {"dimension": {"sheetId": sheet_id, "majorDimension": "COLUMNS", "length": 1}},
            )
        else:
            self.request(
                "POST",
                f"{API_ROOT}/sheets/v2/spreadsheets/{self.spreadsheet_token}/insert_dimension_range",
                {
                    "dimension": {
                        "sheetId": sheet_id,
                        "majorDimension": "COLUMNS",
                        "startIndex": last_used,
                        "endIndex": last_used + 1,
                    },
                    "inheritStyle": "BEFORE",
                },
            )
        column = column_letter(last_used + 1)
        self.write_cell(sheet_id, f"{column}1", component)
        return column

    def latest_image(self, sheet_title: str, component: str, fallback_repository: str) -> str:
        sheet_id = self.sheet_id(sheet_title)
        column = self.component_column(sheet_id, component, create=False)
        repository_rows = self.values(f"{sheet_id}!{column}2:{column}2")
        repository = cell_text(repository_rows[0][0]) if repository_rows and repository_rows[0] else ""
        repository = repository or fallback_repository
        if not repository:
            fail(f"repository missing for {sheet_title}/{component}")
        for row in self.values(f"{sheet_id}!{column}4:{column}2000"):
            if row and cell_text(row[0]):
                return f"{repository}:{cell_text(row[0])}"
        fail(f"image tag missing for {sheet_title}/{component}")

    def write_image(self, sheet_title: str, component: str, repository: str, tag: str, date: str) -> None:
        sheet_id = self.sheet_id(sheet_title)
        date_row = 0
        for row_number, row in enumerate(self.values(f"{sheet_id}!A4:A2000"), start=4):
            if row and cell_text(row[0]) == date:
                date_row = row_number
                break
        if date_row == 0:
            self.request(
                "POST",
                f"{API_ROOT}/sheets/v2/spreadsheets/{self.spreadsheet_token}/values_prepend",
                {"valueRange": {"range": f"{sheet_id}!A4:A4", "values": [[date]]}},
            )
            date_row = 4
        column = self.component_column(sheet_id, component, create=True)
        self.write_cell(sheet_id, f"{column}1", component)
        self.write_cell(sheet_id, f"{column}2", repository)
        self.write_cell(sheet_id, f"{column}{date_row}", tag)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    root.add_argument(
        "--spreadsheet-token",
        default=os.environ.get("FEISHU_SPREADSHEET_TOKEN", DEFAULT_SPREADSHEET_TOKEN),
    )
    commands = root.add_subparsers(dest="command", required=True)

    latest = commands.add_parser("latest")
    latest.add_argument("--sheet", required=True)
    latest.add_argument("--component", required=True)
    latest.add_argument("--fallback-repository", required=True)

    write = commands.add_parser("write")
    write.add_argument("--sheet", required=True)
    write.add_argument("--component", required=True)
    write.add_argument("--repository", required=True)
    write.add_argument("--tag", required=True)
    write.add_argument("--date", required=True)
    return root


def main() -> None:
    args = parser().parse_args()
    sheets = FeishuSheets(args.spreadsheet_token)
    if args.command == "latest":
        print(sheets.latest_image(args.sheet, args.component, args.fallback_repository))
        return
    sheets.write_image(args.sheet, args.component, args.repository, args.tag, args.date)
    print(f"updated {args.sheet}: {args.component}={args.tag}")


if __name__ == "__main__":
    main()
