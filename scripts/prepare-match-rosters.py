"""Publish only team/player names; keep original registration DOCX files local."""
import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
WORD = NS["w"]
MEN = "2026年新生杯男子足球赛"
TEAM_NAMES = {"外国语学院": "外院", "信息管理学院—历史学系联队": "信历", "经济学院": "经济", "生命科学学院": "生科"}


def text(element):
    return "".join(node.text or "" for node in element.findall(".//w:t", NS)).strip()


def extract(path):
    with ZipFile(path) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
    paragraphs = [text(p) for p in document.findall(".//w:p", NS)]
    team_line = next((p for p in paragraphs if "球队：" in p), "")
    found = re.search(r"球队：\s*(.*?)\s*(?:球衣颜色：|$)", team_line)
    if not found or not found[1].strip():
        raise ValueError(f"{path.name}: 缺少球队名称")
    team = found[1].strip()
    tables = document.findall(".//w:tbl", NS)
    if len(tables) != 1:
        raise ValueError(f"{path.name}: 应恰好包含一张名单表格")
    rows = []
    for row in tables[0].findall("w:tr", NS):
        values = []
        for cell in row.findall("w:tc", NS):
            values.append(" ".join(text(p) for p in cell.findall(".//w:p", NS)).strip())
            span = cell.find(".//w:gridSpan", NS)
            if span is not None:
                values.extend([""] * (int(span.get(f"{{{WORD}}}val", "1")) - 1))
        rows.append(values)
    headers = [re.sub(r"\s", "", value) for value in rows[0]] if rows else []
    if len(headers) == 10 and all(headers[i] == "姓名" for i in (0, 5)):
        name_columns = (0, 5)
    elif len(headers) == 6 and headers[:2] == ["序号", "球员姓名"]:
        name_columns = (1,)
    else:
        raise ValueError(f"{path.name}: 不支持的报名表表头")
    names = [row[i].strip() for row in rows[1:] for i in name_columns if len(row) > i and row[i].strip()]
    if not names or len(names) != len(set(names)):
        raise ValueError(f"{path.name}: 名单为空或存在同名球员")
    # The allowlist deliberately excludes phone numbers, notes and document metadata.
    if any(re.search(r"\d{7,}", name) for name in names):
        raise ValueError(f"{path.name}: 姓名列中出现长数字，请检查原始表格")
    return team, [{"team": team, "name": name} for name in names]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="本地 data/manifest.json")
    parser.add_argument("destination", type=Path, help="公开数据输出目录，如 src/data")
    args = parser.parse_args()
    source = json.loads(args.source.read_text())
    manifest = {"version": 1, "tournaments": []}
    for index, tournament in enumerate(source["tournaments"], 1):
        records, teams = [], set()
        for file in tournament["files"]:
            team, players = extract(args.source.parent / tournament["directory"] / file)
            if tournament["name"] == MEN:
                team = TEAM_NAMES.get(team, team)
                players = [{"team": team, "name": "申宇灏" if team == "数学" and p["name"] == "申宇颢" else p["name"]} for p in players]
            if team in teams:
                raise ValueError(f"重复球队：{team}")
            teams.add(team)
            records.extend(players)
        roster = f"rosters/tournament-{index}.json"
        target = args.destination / roster
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")
        entry = {"name": tournament["name"], "roster": roster}
        if tournament.get("lineups") is False:
            entry["lineups"] = False
        manifest["tournaments"].append(entry)
        print(f"{tournament['name']}: {len(teams)} 支球队，{len(records)} 名球员；仅输出球队与姓名")
    args.destination.mkdir(parents=True, exist_ok=True)
    (args.destination / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
