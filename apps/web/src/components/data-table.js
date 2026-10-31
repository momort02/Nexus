export function renderDataTable(
  table,
  { columns, rows, emptyMessage = 'Aucun résultat.' },
) {
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const column of columns) {
    const header = document.createElement('th');
    header.scope = 'col';
    header.textContent = column.label;
    headerRow.append(header);
  }
  head.append(headerRow);

  const body = document.createElement('tbody');
  if (rows.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns.length;
    cell.textContent = emptyMessage;
    row.append(cell);
    body.append(row);
  } else {
    for (const item of rows) {
      const row = document.createElement('tr');
      for (const column of columns) {
        const cell = document.createElement('td');
        const value = column.value(item);
        cell.textContent = value == null ? '—' : String(value);
        row.append(cell);
      }
      body.append(row);
    }
  }

  table.replaceChildren(head, body);
}
