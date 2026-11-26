const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Sheet {
  constructor(parent, name = "Турнир") {
    this.parent = parent;
    this.cells = new Map();
    this.rows = 1000;
    this.columns = 26;
    this.name = name;
    this.hidden = false;
  }
  getParent() {
    return this.parent;
  }
  getName() {
    return this.name;
  }
  setName(name) {
    this.name = name;
  }
  getSheetId() {
    return 1;
  }
  getId() {
    return this.parent.getId();
  }
  getMaxRows() {
    return this.rows;
  }
  getMaxColumns() {
    return this.columns;
  }
  insertColumnsAfter(_, count) {
    this.columns += count;
  }
  insertRowsAfter(_, count) {
    this.rows += count;
  }
  getLastRow() {
    return Math.max(
      0,
      ...[...this.cells.keys()].map((key) => Number(key.split(":")[0])),
    );
  }
  getFilter() {
    return null;
  }
  clearContents() {
    this.cells.clear();
  }
  isSheetHidden() {
    return this.hidden;
  }
  hideSheet() {
    this.hidden = true;
  }
  showSheet() {
    this.hidden = false;
  }
  getRange(row, col, height = 1, width = 1) {
    const sheet = this;
    if (typeof row === "string") {
      const columnNumber = (letters) =>
        [...letters].reduce(
          (number, letter) => number * 26 + letter.charCodeAt(0) - 64,
          0,
        );
      const parseCell = (cell) => {
        const match = cell.match(/^([A-Z]+)(\d+)$/);
        assert.ok(match, `Invalid A1 range: ${row}`);
        return { row: Number(match[2]), col: columnNumber(match[1]) };
      };
      const [startCell, endCell = startCell] = row.split(":");
      const start = parseCell(startCell);
      const end = parseCell(endCell);
      row = start.row;
      col = start.col;
      height = end.row - start.row + 1;
      width = end.col - start.col + 1;
    }
    return {
      getValue() {
        return sheet.cells.get(`${row}:${col}`) ?? "";
      },
      getValues() {
        return Array.from({ length: height }, (_, r) =>
          Array.from(
            { length: width },
            (_, c) => sheet.cells.get(`${row + r}:${col + c}`) ?? "",
          ),
        );
      },
      setValue(value) {
        sheet.cells.set(`${row}:${col}`, value);
        return this;
      },
      setValues(values) {
        assert.equal(values.length, height);
        values.forEach((line, r) => {
          assert.equal(line.length, width);
          line.forEach((value, c) =>
            sheet.cells.set(`${row + r}:${col + c}`, value),
          );
        });
        return this;
      },
      setNumberFormat() {
        return this;
      },
      setFontWeight() {
        return this;
      },
      setBackground() {
        return this;
      },
      setVerticalAlignment() {
        return this;
      },
      createFilter() {
        return this;
      },
    };
  }
  setFrozenRows() {}
  setColumnWidth() {}
  autoResizeColumns() {}
  showColumns() {}
  hideColumns() {}
  showRows() {}
  hideRows() {}
  setTabColor() {}
}

class Spreadsheet {
  constructor() {
    this.id = "test-spreadsheet";
    this.sheets = [new Sheet(this)];
    this.sheet = this.sheets[0];
  }
  getId() {
    return this.id;
  }
  getSheets() {
    return this.sheets;
  }
  getSheetByName(name) {
    return this.sheets.find((sheet) => sheet.name === name) ?? null;
  }
  insertSheet(name) {
    const sheet = new Sheet(this, name);
    this.sheets.push(sheet);
    return sheet;
  }
  getSpreadsheetTimeZone() {
    return "UTC";
  }
}

function zonedParts(value, timeZone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .map(({ type, value: part }) => [type, part]),
  );
}

function formatDate(value, timeZone, pattern) {
  const parts = zonedParts(value, timeZone);
  if (pattern === "HH:mm") return `${parts.hour}:${parts.minute}`;
  if (pattern === "yyyy-MM-dd")
    return `${parts.year}-${parts.month}-${parts.day}`;
  if (pattern === "dd.MM.yyyy HH:mm:ss")
    return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
  throw new Error(`Unsupported test date format: ${pattern}`);
}

function parseDate(value, timeZone) {
  const match = String(value).match(
    /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) throw new Error(`Unsupported test date value: ${value}`);
  const [, day, month, year, hour, minute, second] = match;
  const target = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  let result = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(result), timeZone);
    const displayedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    result += target - displayedAsUtc;
  }
  return new Date(result);
}

function createContext({
  spreadsheet = new Spreadsheet(),
  adminKey = "test-admin-key",
} = {}) {
  const properties = new Map([
    ["FRIENDLY_POKER_ADMIN_KEY", adminKey],
    ["FRIENDLY_POKER_SPREADSHEET_ID", spreadsheet.getId()],
  ]);
  const lock = {
    locked: false,
    waitLock() {
      this.locked = true;
    },
    hasLock() {
      return this.locked;
    },
    releaseLock() {
      this.locked = false;
    },
  };
  const textOutput = (content) => ({
    content,
    mimeType: "",
    setMimeType(mimeType) {
      this.mimeType = mimeType;
      return this;
    },
    getContent() {
      return this.content;
    },
  });
  const context = vm.createContext({
    console,
    Date,
    isNaN,
    Utilities: { formatDate, parseDate },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties.get(key) ?? null,
        setProperty: (key, value) => properties.set(key, value),
      }),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    LockService: { getScriptLock: () => lock },
    ContentService: {
      MimeType: {
        JSON: "application/json",
        JAVASCRIPT: "application/javascript",
        TEXT: "text/plain",
      },
      createTextOutput: textOutput,
    },
  });
  const code = fs.readFileSync(
    path.join(__dirname, "../../google-apps-script/Code.gs"),
    "utf8",
  );
  vm.runInContext(code, context);
  return context;
}

module.exports = { Sheet, Spreadsheet, createContext };
