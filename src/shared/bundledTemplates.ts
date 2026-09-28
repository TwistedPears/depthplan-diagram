import {
  createRecursiveDocument,
  type Geometry,
  type RecursiveDocument,
} from './recursiveDocument';
import { createTemplate } from './templates';

const guidance =
  'Insert this example, then rename, duplicate, delete and connect its shapes using the normal board tools. Expand children to explore the details.';
function object(
  document: RecursiveDocument,
  id: string,
  parentId: string | null,
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = '#eff6ff',
  type: 'frame' | 'rectangle' | 'diamond' = 'rectangle',
) {
  document.objects[id] = {
    id,
    parentId,
    name,
    type,
    content: [{ type: 'paragraph', runs: [{ text }] }],
    geometry: {
      x,
      y,
      width,
      height,
      z: Object.keys(document.objects).length,
      rotation: 0,
    },
    style: { fill, stroke: '#64748b', clipToFrame: false },
  };
}
function connection(
  document: RecursiveDocument,
  id: string,
  ownerId: string,
  start: string,
  end: string,
  label: string,
) {
  document.connections[id] = {
    id,
    ownerId,
    kind: 'arrow',
    z: 100,
    start: {
      kind: 'object',
      objectId: start,
      side: 'right',
      offset: 0.5,
      binding: 'auto',
    },
    end: {
      kind: 'object',
      objectId: end,
      side: 'left',
      offset: 0.5,
      binding: 'auto',
    },
    label,
    style: { stroke: '#475569', endArrowhead: 'arrow' },
  };
}
function layouts(document: RecursiveDocument, root: string, maximum: number) {
  document.layouts[root] = {};
  for (let depth = 0; depth <= maximum; depth++) {
    const layout: Record<string, Geometry> = {};
    for (const o of Object.values(document.objects)) {
      let generation = 0;
      for (let p = o.parentId; p !== null; p = document.objects[p].parentId)
        generation++;
      if (generation <= depth)
        layout[o.id] = {
          ...o.geometry,
          ...(depth === 0 ? { width: 360, height: 160 } : {}),
        };
    }
    document.layouts[root][depth] = layout;
  }
  document.rootDepths[root] = 1;
}
function finish(
  document: RecursiveDocument,
  id: string,
  description: string,
  tags: string[],
) {
  for (const root of Object.keys(document.rootDepths))
    document.rootDepths[root] = Math.max(
      ...Object.keys(document.layouts[root]).map(Number),
    );
  const template = createTemplate(document, {
    formatVersion: 1,
    id,
    version: 1,
    name: document.metadata.title,
    description,
    tags,
    guidance,
    components: [],
    excludedConnections: [],
  });
  // Keep bundled export metadata stable.
  template.metadata.created = template.metadata.modified =
    '2026-09-28T00:00:00.000Z';
  return template;
}
function erd() {
  const d = createRecursiveDocument('erd-source', 'ERD · database schema');
  object(
    d,
    'database',
    null,
    'commerce / public',
    'Schema overview. Expand to inspect tables; expand a table for columns. Add tables under this database and columns under a table.',
    0,
    0,
    1120,
    620,
    '#f8fafc',
    'frame',
  );
  object(
    d,
    'customers',
    'database',
    'customers',
    'One row per customer. Naming: plural snake_case tables; singular snake_case columns.',
    -260,
    0,
    390,
    340,
  );
  object(
    d,
    'orders',
    'database',
    'orders',
    'One row per order. customer_id references customers.id.',
    260,
    0,
    390,
    340,
  );
  for (const [table, rows] of [
    [
      'customers',
      [
        'id · UUID · PK · NOT NULL',
        'email · TEXT · UNIQUE · NOT NULL',
        'display_name · TEXT · NULL',
      ],
    ],
    [
      'orders',
      [
        'id · UUID · PK · NOT NULL',
        'customer_id · UUID · FK · NOT NULL',
        'total · DECIMAL(12,2) · NOT NULL',
      ],
    ],
  ] as const)
    rows.forEach((row, i) =>
      object(
        d,
        `${table}-column-${i}`,
        table,
        row,
        'Edit name, type, nullability and key annotation. This is documentation; no SQL is executed.',
        0,
        -70 + i * 85,
        345,
        66,
        '#ffffff',
      ),
    );
  connection(
    d,
    'foreign-key',
    'database',
    'orders-column-1',
    'customers-column-0',
    'orders.customer_id → customers.id',
  );
  d.connections['foreign-key'].style = {
    ...d.connections['foreign-key'].style,
    startArrowhead: 'crowfoot_many',
    endArrowhead: 'bar',
  };
  layouts(d, 'database', 2);
  return finish(
    d,
    'bundled-erd',
    'An editable database, tables, columns and a labeled foreign-key relationship.',
    ['database', 'ERD', 'SQL'],
  );
}
function infrastructure() {
  const d = createRecursiveDocument(
    'infrastructure-source',
    'Isometric infrastructure',
  );
  object(
    d,
    'site',
    null,
    'prod / west',
    'Editable 2D infrastructure. Staggered diamonds form rack planes; no 3D renderer. Add racks under this environment.',
    0,
    0,
    1150,
    760,
    '#f8fafc',
    'frame',
  );
  object(
    d,
    'rack',
    'site',
    'zone-a / rack-01',
    'Naming: environment-zone-role-number. Expand to see a staggered server and switch arrangement.',
    0,
    10,
    900,
    610,
    '#e0f2fe',
    'diamond',
  );
  object(
    d,
    'server',
    'rack',
    'prod-a-app-01',
    'Application server · 8 vCPU / 32 GiB. Expand for ports and services.',
    -150,
    -90,
    290,
    180,
    '#dbeafe',
  );
  object(
    d,
    'switch',
    'rack',
    'prod-a-sw-01',
    'Access switch · VLAN 20. Expand to inspect uplink.',
    160,
    95,
    290,
    180,
    '#ccfbf1',
  );
  object(
    d,
    'port',
    'server',
    'eth0 / HTTPS',
    'TCP 443 · VLAN 20 · describe purpose, protocol and peer.',
    0,
    30,
    245,
    75,
    '#ffffff',
  );
  object(
    d,
    'uplink',
    'switch',
    'Gi1/0/1',
    'Server uplink · VLAN 20 · 1 Gbit/s',
    0,
    30,
    245,
    75,
    '#ffffff',
  );
  connection(d, 'network-link', 'rack', 'port', 'uplink', 'VLAN 20 · 1 Gbit/s');
  layouts(d, 'site', 3);
  return finish(
    d,
    'bundled-isometric',
    'A site, rack, server, switch and ports arranged on an isometric rack plane using editable 2D shapes.',
    ['network', 'infrastructure', 'isometric'],
  );
}
function purdue() {
  const d = createRecursiveDocument('purdue-source', 'ISA-95 / Purdue Model');
  object(
    d,
    'plant',
    null,
    'Plant A · functional architecture',
    'Levels 0–4 describe functions; D0, D1… describe diagram disclosure. The optional 3.5 band is a Purdue security adaptation. This diagram does not certify security or compliance.',
    0,
    0,
    1120,
    1780,
    '#f8fafc',
    'frame',
  );
  const rows = [
    [
      'level4',
      'Level 4 · enterprise / business planning',
      'ERP · planning and logistics',
      'erp',
      '#ede9fe',
    ],
    [
      'dmz',
      '3.5 · optional industrial DMZ adaptation',
      'Broker · mediated IT/OT exchange',
      'broker',
      '#fef3c7',
    ],
    [
      'level3',
      'Level 3 · manufacturing operations',
      'MES / MOM · production coordination',
      'mes',
      '#dbeafe',
    ],
    [
      'level2',
      'Level 2 · supervisory control',
      'HMI / SCADA · operator supervision',
      'scada',
      '#ccfbf1',
    ],
    [
      'level1',
      'Level 1 · sensing / manipulation and basic control',
      'PLC-01 · cell controller',
      'plc',
      '#dcfce7',
    ],
    [
      'level0',
      'Level 0 · physical process',
      'Line-01 · tank and conveyor',
      'process',
      '#ffedd5',
    ],
  ];
  rows.forEach(([id, name, app, appId, fill], i) => {
    object(
      d,
      id,
      'plant',
      name,
      id === 'dmz'
        ? 'Optional common Purdue network-security adaptation, distinct from ISA-95 functional levels. Delete if not applicable.'
        : 'Peer functional level. Add areas, controllers or applications here; keep its level label when changing disclosure depth.',
      0,
      -700 + i * 280,
      990,
      245,
      fill,
      'frame',
    );
    object(
      d,
      appId,
      id,
      app,
      'Document responsibility, owner and information/control boundaries. Use site-area-role-number naming.',
      -190,
      20,
      500,
      160,
      '#ffffff',
    );
  });
  object(
    d,
    'sensor',
    'plc',
    'TT-101 / sensor',
    'Temperature input · engineering units °C',
    -110,
    35,
    210,
    65,
    '#f0fdf4',
  );
  object(
    d,
    'actuator',
    'plc',
    'XV-101 / actuator',
    'Valve output · document safe state',
    115,
    35,
    210,
    65,
    '#f0fdf4',
  );
  connection(d, 'control-loop', 'plc', 'sensor', 'actuator', 'control signal');
  connection(d, 'erp-broker', 'plant', 'erp', 'broker', 'production plan');
  connection(d, 'broker-mes', 'plant', 'broker', 'mes', 'approved exchange');
  connection(
    d,
    'mes-scada',
    'plant',
    'mes',
    'scada',
    'schedule / production status',
  );
  connection(d, 'scada-plc', 'plant', 'scada', 'plc', 'setpoints / telemetry');
  connection(d, 'plc-process', 'plant', 'plc', 'process', 'control / feedback');
  layouts(d, 'plant', 3);
  return finish(
    d,
    'bundled-purdue',
    'A functional IT/OT architecture with peer levels 0–4, an optional DMZ band and labeled information/control flows.',
    ['ISA-95', 'Purdue', 'industrial', 'IT/OT'],
  );
}
export const bundledTemplates = [erd(), infrastructure(), purdue()];
