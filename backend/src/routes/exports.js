import express from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

export const exportsRouter = express.Router();

const pad = (value) => String(value).padStart(2, '0');
const monthPattern = /^(\d{4})-(\d{2})$/;

const parseStartMonth = (value) => {
  const match = monthPattern.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
};

const addMonths = ({ year, month }, offset) => {
  const index = year * 12 + (month - 1) + offset;
  return {
    year: Math.floor(index / 12),
    month: (index % 12) + 1
  };
};

const monthKey = (month) => `${month.year}-${pad(month.month)}`;

const monthStart = (month) => `${monthKey(month)}-01`;

const parseMonthCount = (value) => {
  const count = Number(value || 1);
  if (!Number.isInteger(count) || count < 1 || count > 12) return null;
  return count;
};

const parseUserIds = (value) => {
  const raw = String(value || 'all').trim();
  if (!raw || raw === 'all') return [];
  const ids = raw.split(',').map((item) => Number(item.trim())).filter((id) => Number.isInteger(id) && id > 0);
  return Array.from(new Set(ids));
};

const safeXmlText = (value) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')
  .replace(/\r?\n/g, '&#10;');

const safeFileName = (value) => String(value || '工作日历导出').replace(/[\\/:*?"<>|]/g, '-');

const safeSheetName = (value, usedNames) => {
  const raw = String(value || '成员').replace(/[\\/?*\[\]:]/g, ' ').trim() || '成员';
  const base = raw.slice(0, 31) || '成员';
  let name = base;
  let index = 2;
  while (usedNames.has(name)) {
    const suffix = `(${index})`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    index += 1;
  }
  usedNames.add(name);
  return name;
};

const cell = (value, styleId = 'Default', options = {}) => {
  const style = styleId ? ` ss:StyleID="${styleId}"` : '';
  const merge = options.mergeAcross ? ` ss:MergeAcross="${options.mergeAcross}"` : '';
  return `<Cell${style}${merge}><Data ss:Type="String">${safeXmlText(value)}</Data></Cell>`;
};

const row = (cells, height, autoFitHeight = false) => {
  const heightAttr = height ? ` ss:Height="${height}" ss:AutoFitHeight="${autoFitHeight ? 1 : 0}"` : '';
  return `<Row${heightAttr}>${cells.join('')}</Row>`;
};

const monthTitle = (month) => `${month.year}年 ${month.month}月`;

const completionText = (total, completed) => `${total ? Math.round((completed / total) * 100) : 0}%`;

const dateKey = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

const memoExportText = (memo) => {
  const status = memo.completed ? '✓' : '○';
  const time = memo.dueTime ? ` · 截止 ${new Date(memo.dueTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '';
  const detail = String(memo.content || '').trim();
  const titleLine = `${status} 任务：${memo.title}${time}`;
  return detail ? `${titleLine}\n  内容：${detail}` : titleLine;
};

const monthCells = (month, memosByDate) => {
  const firstDay = new Date(month.year, month.month - 1, 1);
  const lastDay = new Date(month.year, month.month, 0);
  const cells = [];

  for (let index = 0; index < firstDay.getDay(); index += 1) {
    cells.push(cell('', 'EmptyDay'));
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const key = dateKey(month.year, month.month, day);
    const memos = memosByDate.get(key) || [];
    const content = [String(day), ...memos.map(memoExportText)].join('\n\n');
    cells.push(cell(content, memos.length ? 'DayWithMemo' : 'DayCell'));
  }

  while (cells.length < 42) {
    cells.push(cell('', 'EmptyDay'));
  }

  return Array.from({ length: 6 }, (_, index) => row(cells.slice(index * 7, index * 7 + 7), 84, true));
};

const groupMemosByDate = (memos) => {
  const result = new Map();
  for (const memo of memos) {
    if (!result.has(memo.date)) result.set(memo.date, []);
    result.get(memo.date).push(memo);
  }
  return result;
};

const worksheetForUser = (user, months, memos, sheetName) => {
  const completed = memos.filter((memo) => memo.completed).length;
  const pending = memos.length - completed;
  const rows = [];

  rows.push(row([cell(`${user.displayName} 工作日历`, 'SheetTitle', { mergeAcross: 6 })], 30));
  rows.push(row([cell(`岗位：${user.jobTitle || ''}    部门：${user.departmentName || ''}    周期：${monthKey(months[0])} 至 ${monthKey(months[months.length - 1])}`, 'SheetSubTitle', { mergeAcross: 6 })], 24));
  rows.push(row([cell(`总任务 ${memos.length}`, 'StatTotal'), cell(`已完成 ${completed}`, 'StatCompleted'), cell(`未完成 ${pending}`, 'StatPending'), cell(`完成进度 ${completionText(memos.length, completed)}`, 'StatRate', { mergeAcross: 3 })], 24));
  rows.push(row([cell('', 'Blank', { mergeAcross: 6 })], 10));

  for (const month of months) {
    const monthPrefix = monthKey(month);
    const monthMemos = memos.filter((memo) => memo.date.startsWith(monthPrefix));
    const monthCompleted = monthMemos.filter((memo) => memo.completed).length;
    const memosByDate = groupMemosByDate(monthMemos);

    rows.push(row([cell(monthTitle(month), 'MonthTitle', { mergeAcross: 6 })], 28));
    rows.push(row([cell(`总任务 ${monthMemos.length}    已完成 ${monthCompleted}    未完成 ${monthMemos.length - monthCompleted}    完成进度 ${completionText(monthMemos.length, monthCompleted)}`, 'MonthStats', { mergeAcross: 6 })], 24));
    rows.push(row(['日', '一', '二', '三', '四', '五', '六'].map((day) => cell(day, 'Weekday')), 22));
    rows.push(...monthCells(month, memosByDate));
    rows.push(row([cell('', 'Blank', { mergeAcross: 6 })], 12));
  }

  return `
    <Worksheet ss:Name="${safeXmlText(sheetName)}">
      <Table ss:ExpandedColumnCount="7" ss:ExpandedRowCount="${rows.length}" x:FullColumns="1" x:FullRows="1">
        ${Array.from({ length: 7 }, () => '<Column ss:Width="118"/>').join('')}
        ${rows.join('')}
      </Table>
      <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
        <FreezePanes/>
        <FrozenNoSplit/>
        <SplitHorizontal>6</SplitHorizontal>
        <TopRowBottomPane>6</TopRowBottomPane>
        <ActivePane>2</ActivePane>
        <PageSetup>
          <Layout x:Orientation="Landscape"/>
        </PageSetup>
        <FitToPage/>
        <Print>
          <FitWidth>1</FitWidth>
          <FitHeight>0</FitHeight>
        </Print>
      </WorksheetOptions>
    </Worksheet>`;
};

const workbookXml = (worksheets) => `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top"/><Font ss:FontName="Microsoft YaHei" ss:Size="10"/></Style>
    <Style ss:ID="SheetTitle"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="18" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1A237E" ss:Pattern="Solid"/></Style>
    <Style ss:ID="SheetSubTitle"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Color="#495057"/><Interior ss:Color="#F1F3F5" ss:Pattern="Solid"/></Style>
    <Style ss:ID="StatTotal"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#1A237E"/><Interior ss:Color="#E8EAF6" ss:Pattern="Solid"/></Style>
    <Style ss:ID="StatCompleted"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#2E7D32"/><Interior ss:Color="#E8F5E9" ss:Pattern="Solid"/></Style>
    <Style ss:ID="StatPending"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#C62828"/><Interior ss:Color="#FFEBEE" ss:Pattern="Solid"/></Style>
    <Style ss:ID="StatRate"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#3949AB"/><Interior ss:Color="#E3F2FD" ss:Pattern="Solid"/></Style>
    <Style ss:ID="MonthTitle"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="14" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#4361EE" ss:Pattern="Solid"/></Style>
    <Style ss:ID="MonthStats"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#495057"/><Interior ss:Color="#F8F9FA" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Weekday"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#3A0CA3" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFFFFF"/></Borders></Style>
    <Style ss:ID="DayCell"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Font ss:FontName="Microsoft YaHei" ss:Size="9" ss:Color="#212529"/><Interior ss:Color="#F8F9FA" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DEE2E6"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DEE2E6"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DEE2E6"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DEE2E6"/></Borders></Style>
    <Style ss:ID="DayWithMemo"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Font ss:FontName="Microsoft YaHei" ss:Size="9" ss:Color="#212529"/><Interior ss:Color="#FFFDE7" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFD54F"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFD54F"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFD54F"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFD54F"/></Borders></Style>
    <Style ss:ID="EmptyDay"><Interior ss:Color="#ECEFF1" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DEE2E6"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DEE2E6"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DEE2E6"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DEE2E6"/></Borders></Style>
    <Style ss:ID="Blank"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/></Style>
  </Styles>
  ${worksheets.join('')}
</Workbook>`;

exportsRouter.get('/calendar', authRequired, async (req, res) => {
  const isStaff = req.user.role !== 'admin';
  const startMonth = parseStartMonth(req.query.startMonth);
  const monthCount = parseMonthCount(req.query.months);
  if (!startMonth || !monthCount) {
    return res.status(400).json({ message: '月份参数无效' });
  }

  const requestedUserIds = isStaff ? [Number(req.user.id)] : parseUserIds(req.query.userIds);
  if (!isStaff && String(req.query.userIds || 'all') !== 'all' && requestedUserIds.length === 0) {
    return res.status(400).json({ message: '请选择要导出的人员' });
  }

  const months = Array.from({ length: monthCount }, (_, index) => addMonths(startMonth, index));
  const endMonth = addMonths(startMonth, monthCount);

  const userWhere = requestedUserIds.length ? 'WHERE users.id = ANY($1::int[])' : '';
  const userParams = requestedUserIds.length ? [requestedUserIds] : [];
  const usersResult = await query(
    `
    SELECT users.id, users.username, users.display_name AS "displayName", users.role,
           users.job_title AS "jobTitle", users.department_id AS "departmentId", departments.name AS "departmentName"
    FROM users
    JOIN departments ON departments.id = users.department_id
    ${userWhere}
    ORDER BY users.display_name ASC, users.id ASC
    `,
    userParams
  );

  if (!usersResult.rowCount) {
    return res.status(404).json({ message: '没有可导出的人员' });
  }

  if (requestedUserIds.length && usersResult.rowCount !== requestedUserIds.length) {
    return res.status(404).json({ message: '部分人员不存在' });
  }

  const userIds = usersResult.rows.map((user) => Number(user.id));
  const memosResult = await query(
    `
    SELECT memos.id, memos.owner_id AS "ownerId", to_char(memos.date, 'YYYY-MM-DD') AS date,
           memos.title, memos.content, memos.color, memos.completed, memos.due_time AS "dueTime",
           memos.created_at AS "createdAt", memos.updated_at AS "updatedAt"
    FROM memos
    WHERE memos.date >= $1 AND memos.date < $2 AND memos.owner_id = ANY($3::int[])
    ORDER BY memos.owner_id ASC, memos.date ASC, memos.id ASC
    `,
    [monthStart(startMonth), monthStart(endMonth), userIds]
  );

  const memosByUser = new Map(userIds.map((id) => [id, []]));
  for (const memo of memosResult.rows) {
    const ownerId = Number(memo.ownerId);
    if (memosByUser.has(ownerId)) memosByUser.get(ownerId).push(memo);
  }

  const usedSheetNames = new Set();
  const worksheets = usersResult.rows.map((user) => worksheetForUser(
    user,
    months,
    memosByUser.get(Number(user.id)) || [],
    safeSheetName(user.displayName, usedSheetNames)
  ));

  const filename = safeFileName(`工作日历-${monthKey(startMonth)}-${monthCount}个月.xls`);
  const content = workbookXml(worksheets);
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  return res.send(content);
});