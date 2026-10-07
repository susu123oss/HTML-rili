import { deflateRawSync } from 'node:zlib';

// Small OOXML writer: the weekly export uses text, dates, merges and print settings.
// Inline strings keep user content literal, including values beginning with '='.
const xml = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dayMs = 86400000;
export function parseReportWeek(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) return null;
  return Array.from({ length: 15 }, (_, i) => new Date(date.getTime() + i * dayMs).toISOString().slice(0, 10));
}

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function zip(files) {
  const parts = [], directory = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(text), packed = deflateRawSync(data);
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    parts.push(header, filename, packed); directory.push(central, filename);
    offset += header.length + filename.length + packed.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length / 2, 8); end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const col = (i) => String.fromCharCode(65 + i);
const cell = (r, c, value, style = 0) => typeof value === 'number'
  ? `<c r="${col(c)}${r}" s="${style}"><v>${value}</v></c>`
  : `<c r="${col(c)}${r}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
const row = (r, values, height = 24, styles = []) => `<row r="${r}" ht="${height}" customHeight="1">${values.map((v, c) => cell(r, c, v, styles[c] ?? 0)).join('')}</row>`;
const lines = (text, width) => String(text || '').split('\n').reduce((n, s) => n + Math.max(1, Math.ceil([...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) / width)), 0);
const height = (values, widths) => Math.min(409, Math.max(42, ...values.map((v, i) => lines(v, widths[i]) * 15 + 12)));
const status = (memo) => memo.rolloverToId ? '已顺延' : memo.completed ? (memo.expectedDeliverable || memo.actualDeliverable ? '已确认' : '已完成')
  : memo.deliveryStatus === 'submitted' ? '待确认' : memo.deliveryStatus === 'returned' ? '退回修改' : '进行中';
const uniqueText = (values) => [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))].join('\n');

function sheetXml(rows, widths, merges = [], lastRow = rows.length, headerRows = 5) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${col(widths.length - 1)}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headerRows}" topLeftCell="A${headerRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

export function buildWeeklyReport({ weekStart, users, memos, summaries }) {
  const days = parseReportWeek(weekStart);
  if (!days) throw new Error('请选择有效的周一日期');
  const widths = [6, 14, 52, 9, 14, 10, 10, 12, 11, 11, 11, 11, 11, 11, 11, 44];
  const merges = ['A1:P1', 'A2:P2', 'A3:A5', 'B3:B5', 'C3:C5', 'D3:G3', 'H3:H5', 'I3:O3', 'I4:O4', 'P3:P5', 'D4:D5', 'E4:E5', 'F4:F5', 'G4:G5'];
  const rows = [
    row(1, ['全员周工作计划表', ...Array(15).fill('')], 30, Array(16).fill(1)),
    row(2, [`${days[0]} 至 ${days[6]}；每日进度按事项所属日期展示当前状态；工作分类未录入时留空供补填`, ...Array(15).fill('')], 26, Array(16).fill(2)),
    row(3, ['序号', '项目小组（部门）', '工作任务', '工作分类', '', '', '', '负责人', '进度控制', '', '', '', '', '', '', '下周计划'], 26, Array(16).fill(3)),
    row(4, ['', '', '', '预研', '新设计和测试任务', '团队管理', '沟通协作', '', `${days[0]} 至 ${days[6]}`, '', '', '', '', '', '', ''], 30, Array(16).fill(3)),
    row(5, ['', '', '', '', '', '', '', '', ...days.slice(0, 7).map(d => (Date.parse(`${d}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / dayMs), ''], 24, [...Array(8).fill(3), ...Array(7).fill(4), 3])
  ];
  let seq = 0, r = 6;
  for (const user of users) {
    const mine = memos.filter(m => Number(m.ownerId) === Number(user.id));
    const thisWeek = mine.filter(m => m.date >= days[0] && m.date < days[7]);
    const nextWeek = mine.filter(m => m.date >= days[7] && m.date < days[14]);
    const nextSummary = summaries.find(s => Number(s.ownerId) === Number(user.id) && s.weekStart === days[7]);
    const nextText = uniqueText([nextSummary?.goals && `下周目标：${nextSummary.goals}`, nextSummary?.deliverables && `预期交付：${nextSummary.deliverables}`,
      ...nextWeek.map(m => `${m.date.slice(5)} ${m.title}${m.expectedDeliverable ? `（交付：${m.expectedDeliverable}）` : ''}`)]);
    const groups = new Map();
    for (const m of thisWeek) {
      const key = JSON.stringify([m.title, m.content || '', m.expectedDeliverable || '', m.planKind || 'memo']);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    const userStart = r;
    for (const group of groups.size ? groups.values() : [[]]) {
      const first = group[0];
      const task = first ? uniqueText([first.title, first.content, first.expectedDeliverable && `预期交付：${first.expectedDeliverable}`,
        ...group.map(m => m.actualDeliverable && `${m.date.slice(5)} 实际成果：${m.actualDeliverable}`),
        ...group.map(m => m.reviewComment && `${m.date.slice(5)} 验收意见：${m.reviewComment}`)]) : '本周未录入事项';
      const values = [++seq, user.departmentName || '', task, '', '', '', '', user.displayName || user.username || '',
        ...days.slice(0, 7).map(d => uniqueText(group.filter(m => m.date === d).map(status))), r === userStart ? nextText : ''];
      const styles = values.map((_, i) => i === 2 || i === 15 ? 0 : 5);
      for (let i = 8; i < 15; i++) {
        if (/退回/.test(values[i])) styles[i] = 8;
        else if (/待确认/.test(values[i])) styles[i] = 7;
        else if (/已确认|已完成/.test(values[i])) styles[i] = 6;
      }
      rows.push(row(r++, values, height(values, widths), styles));
    }
    if (r - userStart > 1) for (const c of ['B', 'H', 'P']) merges.push(`${c}${userStart}:${c}${r - 1}`);
  }
  const summaryWidths = [14, 14, 38, 38, 45, 38, 38, 38];
  const summaryRows = [row(1, ['全员目标与复盘', '', '', '', '', '', '', ''], 30, Array(8).fill(1)),
    row(2, [`${days[0]} 至 ${days[6]}`, '', '', '', '', '', '', ''], 24, Array(8).fill(2)),
    row(3, ['负责人', '部门', '本周目标', '预期交付', '实际完成与偏差', '风险与支持', '下周目标', '下周预期交付'], 28, Array(8).fill(3))];
  for (const user of users) {
    const current = summaries.find(s => Number(s.ownerId) === Number(user.id) && s.weekStart === days[0]) || {};
    const next = summaries.find(s => Number(s.ownerId) === Number(user.id) && s.weekStart === days[7]) || {};
    const values = [user.displayName || user.username, user.departmentName || '', current.goals || '', current.deliverables || '', current.actual || '', current.risks || '', next.goals || '', next.deliverables || ''];
    summaryRows.push(row(summaryRows.length + 1, values, height(values, summaryWidths)));
  }
  const fonts = ['<font><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FF1F2937"/></font>', '<font><b/><sz val="16"/><name val="Microsoft YaHei"/></font>', '<font><b/><sz val="10"/><name val="Microsoft YaHei"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', ...['E2F0D9', 'F1F5F9', 'DCFCE7', 'FEF3C7', 'FEE2E2'].map(c => `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`)];
  const xf = (font, fill, border, align = 'left', numFmt = 0) => `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyAlignment="1" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"><alignment horizontal="${align}" vertical="top" wrapText="1"/></xf>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="m/d"/></numFmts><fonts count="3">${fonts.join('')}</fonts><fills count="7">${fills.join('')}</fills><borders count="2"><border/><border>${['left', 'right', 'top', 'bottom'].map(s => `<${s} style="thin"><color rgb="FFD1D5DB"/></${s}>`).join('')}<diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9">${[xf(0, 0, 1), xf(1, 0, 0, 'center'), xf(0, 3, 0), xf(2, 2, 1, 'center'), xf(2, 2, 1, 'center', 164), xf(0, 0, 1, 'center'), xf(0, 4, 1, 'center'), xf(0, 5, 1, 'center'), xf(0, 6, 1, 'center')].join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const sheets = [sheetXml(rows, widths, merges, r - 1), sheetXml(summaryRows, summaryWidths, ['A1:H1', 'A2:H2'], summaryRows.length, 3)];
  const files = {
    '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="全员周报" sheetId="1" r:id="rId1"/><sheet name="目标与复盘" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'全员周报'!$1:$5</definedName><definedName name="_xlnm.Print_Titles" localSheetId="1">'目标与复盘'!$1:$3</definedName></definedNames></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = s; });
  return zip(files);
}
