import {
  createRecursiveDocument,
  type Geometry,
  type RecursiveDocument,
} from './recursiveDocument';
import { createTemplate } from './templates';
import { indexHierarchy } from './recursiveHierarchy';

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
  type: 'frame' | 'rectangle' | 'diamond' | 'ellipse' = 'rectangle',
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
function layouts(document: RecursiveDocument, root: string) {
  const hierarchy = indexHierarchy(document.objects);
  const maximum = hierarchy.maximum.get(root)!;
  document.layouts[root] = {};
  for (let depth = 0; depth <= maximum; depth++) {
    const layout: Record<string, Geometry> = {};
    for (const [id, { generation }] of hierarchy.entries) {
      const o = document.objects[id];
      if (generation <= depth)
        layout[o.id] = {
          ...o.geometry,
          ...(depth === 0 ? { width: 360, height: 160 } : {}),
        };
    }
    document.layouts[root][depth] = layout;
  }
  document.rootDepths[root] = maximum;
}
function finish(
  document: RecursiveDocument,
  id: string,
  description: string,
  tags: string[],
  extension: string,
) {
  const root = Object.values(document.objects).find(
    (item) => item.parentId === null,
  )!;
  const children = Object.values(document.objects).filter(
    (item) => item.parentId === root.id,
  );
  const noteY = Math.max(
    root.geometry.height / 2 + 5,
    ...children.map(({ geometry }) => geometry.y + geometry.height / 2 + 60),
  );
  root.geometry.height = noteY * 2 + 100;
  root.geometry.width = Math.max(
    root.geometry.width,
    ...children.map(
      ({ geometry }) => (Math.abs(geometry.x) + geometry.width / 2 + 20) * 2,
    ),
  );
  object(
    document,
    'extend',
    root.id,
    'How to extend this example',
    extension,
    0,
    noteY,
    root.geometry.width - 60,
    80,
    '#ffffff',
  );
  layouts(document, root.id);
  const template = createTemplate(document, {
    formatVersion: 1,
    id,
    version: 1,
    name: document.metadata.title,
    description,
    tags,
    guidance: extension,
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
    470,
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
        '',
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
  return finish(
    d,
    'bundled-erd',
    'An editable database, tables, columns and a labeled foreign-key relationship.',
    ['Architecture & data', 'database', 'ERD', 'SQL', 'data modelling'],
    'Duplicate a table or column; rename its PK/FK/type/nullability annotations and reconnect relationships. No SQL is executed.',
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
    20,
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
    210,
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
  return finish(
    d,
    'bundled-isometric',
    'A site, rack, server, switch and ports arranged on an isometric rack plane using editable 2D shapes.',
    ['Infrastructure & delivery', 'network', 'infrastructure', 'isometric'],
    'Duplicate a device inside its rack, then edit its ports and VLAN links. Use environment-zone-role-number names.',
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
    1240,
    620,
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
      'Level 1 · sensing / basic control',
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
      i < 3 ? -305 : 305,
      -190 + (i % 3) * 190,
      560,
      160,
      fill,
      'frame',
    );
    object(
      d,
      appId,
      id,
      app,
      'Edit responsibility and owner.',
      0,
      15,
      510,
      100,
      '#ffffff',
    );
  });
  object(
    d,
    'sensor',
    'plc',
    'TT-101 / sensor',
    'Temperature input · °C',
    -135,
    18,
    215,
    52,
    '#f0fdf4',
  );
  object(
    d,
    'actuator',
    'plc',
    'XV-101 / actuator',
    'Valve output · safe state',
    135,
    18,
    215,
    52,
    '#f0fdf4',
  );
  connection(d, 'control-loop', 'plc', 'sensor', 'actuator', 'I/O');
  connection(d, 'erp-broker', 'plant', 'erp', 'broker', 'production plan');
  connection(d, 'broker-mes', 'plant', 'broker', 'mes', 'approved exchange');
  connection(d, 'mes-scada', 'plant', 'mes', 'scada', 'schedule');
  d.connections['mes-scada'].points = [
    { x: 0, y: 205 },
    { x: 0, y: -175 },
  ];
  connection(d, 'scada-plc', 'plant', 'scada', 'plc', 'setpoints / telemetry');
  connection(d, 'plc-process', 'plant', 'plc', 'process', 'control / feedback');
  return finish(
    d,
    'bundled-purdue',
    'A functional IT/OT architecture with peer levels 0–4, an optional DMZ band and labeled information/control flows.',
    ['Operations & industry', 'ISA-95', 'Purdue', 'industrial', 'IT/OT'],
    'Duplicate devices within a functional level. D0/D1 are disclosure depth. The optional 3.5 DMZ is a Purdue security adaptation, not an ISA-95 level or compliance certification.',
  );
}

// Coordinates are authored examples, not layout or workflow engines.
function sample(id: string, title: string, width = 1100, height = 620) {
  const d = createRecursiveDocument(`${id}-source`, title);
  object(d, 'sample', null, title, '', 0, 0, width, height, '#f8fafc', 'frame');
  return d;
}
function box(
  d: RecursiveDocument,
  id: string,
  name: string,
  text: string,
  x: number,
  y: number,
  width = 200,
  height = 86,
  fill = '#eff6ff',
  parent = 'sample',
  type: 'frame' | 'rectangle' | 'diamond' | 'ellipse' = 'rectangle',
) {
  object(d, id, parent, name, text, x, y, width, height, fill, type);
}
function wire(
  d: RecursiveDocument,
  start: string,
  end: string,
  label: string,
  points?: { x: number; y: number }[],
) {
  const id = `${start}-${end}`;
  connection(d, id, 'sample', start, end, label);
  if (points) d.connections[id].points = points;
  return d.connections[id];
}

function systemContext() {
  const d = sample('context', 'System context map');
  box(d, 'customer', 'Customer', 'Places and tracks orders', -360, -160);
  box(d, 'staff', 'Store staff', 'Resolves order exceptions', -360, 110);
  box(
    d,
    'app',
    'Ordering application',
    'Owns checkout and order status',
    0,
    -20,
    230,
    110,
    '#dbeafe',
  );
  box(d, 'payments', 'Payments', 'Authorizes charges', 360, -200);
  box(d, 'email', 'Email provider', 'Delivers receipts', 360, 0);
  box(d, 'fulfillment', 'Fulfillment', 'Ships paid orders', 360, 200);
  wire(d, 'customer', 'app', 'order');
  wire(d, 'staff', 'app', 'resolve');
  wire(d, 'app', 'payments', 'charge');
  wire(d, 'app', 'email', 'receipt');
  wire(d, 'app', 'fulfillment', 'ship');
  return finish(
    d,
    'bundled-system-context',
    'Place an ordering application between its users and external partners.',
    ['Architecture & data', 'C4', 'context', 'system', 'integrations'],
    'Duplicate a user or external system, rename it, then connect it with a short interaction label.',
  );
}
function applicationArchitecture() {
  const d = sample(
    'application',
    'Application / service architecture',
    1180,
    680,
  );
  box(d, 'web', 'Web client', 'Cart and checkout UI', -450, -200, 190);
  box(d, 'api', 'API gateway', 'Authenticate and route', -130, -200, 200);
  box(
    d,
    'services',
    'Order platform',
    'Expand to inspect responsibilities',
    80,
    90,
    650,
    280,
    '#f0f9ff',
    'sample',
    'frame',
  );
  box(
    d,
    'orders',
    'Order service',
    'Accept orders',
    -165,
    -10,
    260,
    180,
    '#dbeafe',
    'services',
  );
  box(
    d,
    'handler',
    'Create order handler',
    'Validate → persist → publish',
    0,
    25,
    230,
    70,
    '#ffffff',
    'orders',
  );
  box(
    d,
    'stock',
    'Inventory service',
    'Reserve and release stock',
    165,
    -10,
    250,
    180,
    '#dcfce7',
    'services',
  );
  box(d, 'db', 'Database', 'Orders and reservations', 430, -210, 210);
  box(d, 'cache', 'Cache', 'Read-only product summaries', -430, 190, 210);
  box(d, 'queue', 'Event queue', 'order.created', 430, 290, 210);
  wire(d, 'web', 'api', 'HTTPS');
  wire(d, 'api', 'orders', 'POST /orders');
  wire(d, 'orders', 'stock', 'reserve');
  wire(d, 'api', 'db', 'read order');
  wire(d, 'orders', 'cache', 'lookup');
  wire(d, 'stock', 'queue', 'publish');
  return finish(
    d,
    'bundled-application-architecture',
    'Trace calls and events through a small ordering platform and its implementation detail.',
    [
      'Architecture & data',
      'services',
      'microservices',
      'software',
      'application',
    ],
    'Duplicate a service inside Order platform; add its data store or event and reconnect the labeled arrows.',
  );
}
function dataPipeline() {
  const d = sample('pipeline', 'Data pipeline', 1200, 600);
  for (const [id, title, text, x, y] of [
    ['orders', 'Order events', 'JSON · every minute', -460, -190],
    ['catalog', 'Product catalog', 'CSV · nightly', -460, 30],
    ['ingest', 'Ingest', 'Land immutable raw records', -180, -80],
    ['validate', 'Validate', 'Required IDs and schema', 90, -80],
    ['reject', 'Rejected records', 'Quarantine + reason', 90, 170],
    ['transform', 'Transform', 'Join products; normalize totals', 380, -80],
    ['store', 'Analytics store', 'Daily sales partitions', 380, 170],
    ['report', 'Sales report', 'Refresh at 08:00', -180, 170],
  ] as const)
    box(d, id, title, text, x, y, 210);
  wire(d, 'orders', 'ingest', 'events');
  wire(d, 'catalog', 'ingest', 'batch');
  wire(d, 'ingest', 'validate', 'raw');
  wire(d, 'validate', 'transform', 'valid');
  wire(d, 'validate', 'reject', 'invalid');
  wire(d, 'transform', 'store', 'load');
  wire(d, 'store', 'report', 'query', [
    { x: 380, y: 240 },
    { x: -180, y: 240 },
  ]);
  return finish(
    d,
    'bundled-data-pipeline',
    'Follow two source formats through validation, quarantine and daily reporting.',
    ['Architecture & data', 'ETL', 'ELT', 'data flow', 'analytics'],
    'Duplicate a source or transform; label its format and cadence, and keep a visible rejected-record path.',
  );
}
function cloudTopology() {
  const d = sample('cloud', 'Cloud deployment topology', 1140, 670);
  box(d, 'internet', 'Internet', 'Browser / mobile clients', -420, -260);
  box(
    d,
    'region',
    'Region · west',
    'Provider-neutral network boundary',
    60,
    35,
    960,
    470,
    '#f0f9ff',
    'sample',
    'frame',
  );
  box(
    d,
    'lb',
    'Load balancer',
    'TLS termination',
    -300,
    -120,
    210,
    86,
    '#dbeafe',
    'region',
  );
  for (const [id, name, y] of [
    ['zone-a', 'Zone A', -70],
    ['zone-b', 'Zone B', 120],
  ] as const) {
    box(d, id, name, '', -20, y, 260, 160, '#ffffff', 'region', 'frame');
    box(
      d,
      `${id}-app`,
      'Application instance',
      'Stateless order API',
      0,
      15,
      220,
      90,
      '#dcfce7',
      id,
    );
    wire(d, 'lb', `${id}-app`, 'HTTPS');
  }
  box(
    d,
    'private',
    'Private data subnet',
    'No direct internet access',
    305,
    -65,
    280,
    200,
    '#fef3c7',
    'region',
    'frame',
  );
  box(
    d,
    'db',
    'Private database',
    'Orders · restricted ingress',
    0,
    20,
    240,
    100,
    '#ffffff',
    'private',
  );
  box(
    d,
    'storage',
    'Object storage',
    'Product images / receipts',
    305,
    140,
    240,
    90,
    '#ede9fe',
    'region',
  );
  wire(d, 'internet', 'lb', '443');
  wire(d, 'zone-a-app', 'db', 'SQL / TLS');
  wire(d, 'zone-b-app', 'storage', 'object API');
  return finish(
    d,
    'bundled-cloud-topology',
    'Deploy two application instances across zones with private data and object storage.',
    [
      'Infrastructure & delivery',
      'cloud',
      'deployment',
      'region',
      'availability',
    ],
    'Duplicate a zone or instance inside the region; edit network boundaries and permitted connection labels.',
  );
}
function networkZones() {
  const d = sample('network', 'Network zones & connectivity', 1180, 650);
  for (const [id, title, text, x, y, fill] of [
    ['edge', 'Edge', 'Internet gateway', -440, -180, '#fee2e2'],
    ['public', 'Public zone', 'Reverse proxy', -140, -180, '#fef3c7'],
    ['application', 'Application zone', 'Order API', 160, -180, '#dbeafe'],
    ['data', 'Data zone', 'Orders database', 460, -180, '#dcfce7'],
    [
      'management',
      'Management zone',
      'Bastion · admin access',
      160,
      170,
      '#ede9fe',
    ],
  ] as const) {
    box(d, id, title, '', x, y, 230, 180, fill, 'sample', 'frame');
    box(
      d,
      `${id}-device`,
      text,
      'Example endpoint',
      0,
      20,
      190,
      100,
      '#ffffff',
      id,
    );
  }
  box(
    d,
    'firewall',
    'Internal firewall',
    'Allow listed flows only',
    -210,
    160,
    230,
  );
  wire(d, 'edge-device', 'public-device', '443');
  wire(d, 'public-device', 'application-device', '8443');
  wire(d, 'application-device', 'data-device', '5432');
  wire(d, 'management-device', 'firewall', 'SSH / 22');
  wire(d, 'firewall', 'public-device', 'admin / 22');
  wire(d, 'management-device', 'application-device', 'admin / 22');
  return finish(
    d,
    'bundled-network-zones',
    'Document example network boundaries and permitted protocols without enforcing policy.',
    [
      'Infrastructure & delivery',
      'network',
      'connectivity',
      'firewall',
      'segmentation',
    ],
    'Duplicate a zone and its endpoint. Edit protocol labels to match actual permitted flows; this is a connectivity example.',
  );
}
function deliveryPipeline() {
  const d = sample('delivery', 'CI/CD delivery pipeline', 1180, 600);
  for (const [id, title, text, x, y] of [
    ['commit', 'Commit', 'Reviewed change', -450, -150],
    ['build', 'Build', 'Compile and package', -150, -150],
    ['tests', 'Tests', 'Unit + integration', 150, -150],
    ['artifact', 'Artifact', 'Immutable version', 450, -150],
    ['staging', 'Staging', 'Smoke + migration check', 450, 100],
    ['approval', 'Approval', 'Release owner', 150, 100],
    ['production', 'Production', 'Canary then expand', -150, 100],
    ['rollback', 'Rollback', 'Restore previous artifact', -450, 100],
  ] as const)
    box(d, id, title, text, x, y, 205);
  for (const [a, b, label] of [
    ['commit', 'build', 'trigger'],
    ['build', 'tests', 'verify'],
    ['tests', 'artifact', 'pass'],
    ['artifact', 'staging', 'deploy'],
    ['staging', 'approval', 'healthy'],
    ['approval', 'production', 'approve'],
    ['production', 'rollback', 'unhealthy'],
  ] as const)
    wire(d, a, b, label);
  wire(d, 'tests', 'commit', 'fail → fix', [
    { x: 150, y: -260 },
    { x: -450, y: -260 },
  ]);
  return finish(
    d,
    'bundled-cicd',
    'Trace a release from commit to production with explicit approval, failure and rollback paths.',
    ['Infrastructure & delivery', 'CI/CD', 'DevOps', 'build', 'release'],
    'Duplicate a stage or check and reconnect the flow. Approval and rollback are editable labels, not executable jobs.',
  );
}
function processFlow() {
  const d = sample('process', 'Basic process flowchart', 1120, 600);
  box(
    d,
    'start',
    'Refund requested',
    '',
    -420,
    -180,
    190,
    70,
    '#dcfce7',
    'sample',
    'ellipse',
  );
  box(d, 'review', 'Review purchase', 'Check date and receipt', -120, -180);
  box(
    d,
    'decision',
    'Eligible?',
    '',
    210,
    -180,
    190,
    130,
    '#fef3c7',
    'sample',
    'diamond',
  );
  box(d, 'refund', 'Issue refund', 'Return original payment', 210, 90);
  box(
    d,
    'end',
    'Customer notified',
    '',
    -120,
    90,
    210,
    80,
    '#dcfce7',
    'sample',
    'ellipse',
  );
  box(
    d,
    'rework',
    'Request missing details',
    'Ask for receipt or reason',
    -420,
    90,
    220,
  );
  wire(d, 'start', 'review', 'submit');
  wire(d, 'review', 'decision', 'check');
  wire(d, 'decision', 'refund', 'yes');
  wire(d, 'refund', 'end', 'complete');
  wire(d, 'decision', 'rework', 'no / incomplete', [
    { x: 420, y: -180 },
    { x: 420, y: 235 },
    { x: -420, y: 235 },
  ]);
  wire(d, 'rework', 'review', 'resubmit');
  return finish(
    d,
    'bundled-flowchart',
    'Resolve a refund request with a decision, labeled outcomes and a rework loop.',
    ['Workflows & decisions', 'flowchart', 'process', 'BPMN', 'refund'],
    'Duplicate an activity or decision; label every decision outcome and reconnect any rework loop.',
  );
}
function swimlane() {
  const d = sample('swimlane', 'Cross-functional swimlane', 1140, 670);
  for (const [id, name, y, color] of [
    ['requester', 'Requester', -210, '#eff6ff'],
    ['operations', 'Operations', 0, '#f0fdf4'],
    ['finance', 'Finance', 210, '#fffbeb'],
  ] as const)
    box(d, id, name, '', 0, y, 1060, 185, color, 'sample', 'frame');
  box(
    d,
    'request',
    'Request refund',
    'Receipt attached',
    -370,
    25,
    220,
    90,
    '#ffffff',
    'requester',
  );
  box(
    d,
    'clarify',
    'Clarify request',
    'Add missing receipt',
    330,
    25,
    220,
    90,
    '#ffffff',
    'requester',
  );
  box(
    d,
    'verify',
    'Verify purchase',
    'Order and policy check',
    -100,
    25,
    220,
    90,
    '#ffffff',
    'operations',
  );
  box(
    d,
    'approve',
    'Approve refund',
    'Record reason',
    330,
    25,
    220,
    90,
    '#ffffff',
    'operations',
  );
  box(
    d,
    'pay',
    'Return payment',
    'Original payment method',
    330,
    25,
    220,
    90,
    '#ffffff',
    'finance',
  );
  box(
    d,
    'reconcile',
    'Reconcile',
    'Close the request',
    -100,
    25,
    220,
    90,
    '#ffffff',
    'finance',
  );
  wire(d, 'request', 'verify', 'handoff');
  wire(d, 'verify', 'approve', 'valid');
  wire(d, 'verify', 'clarify', 'exception');
  wire(d, 'clarify', 'approve', 'receipt supplied');
  wire(d, 'approve', 'pay', 'approved');
  wire(d, 'pay', 'reconcile', 'settled');
  return finish(
    d,
    'bundled-swimlane',
    'Follow a refund across requester, operations and finance, including missing information.',
    ['Workflows & decisions', 'swimlane', 'handoff', 'cross-functional'],
    'Duplicate a lane or activity; keep each activity inside its owner lane and label cross-team handoffs.',
  );
}
function sequence() {
  const d = sample('sequence', 'Sequence / interaction diagram', 1080, 630);
  const participants = ['User', 'Client', 'Service', 'Database'];
  participants.forEach((name, i) => {
    box(d, `p${i}`, name, '', -390 + i * 260, -240, 190, 60);
    d.connections[`lifeline-${i}`] = {
      id: `lifeline-${i}`,
      ownerId: 'sample',
      kind: 'line',
      z: 0,
      start: { kind: 'free', x: -390 + i * 260, y: -210 },
      end: { kind: 'free', x: -390 + i * 260, y: 240 },
      style: { stroke: '#94a3b8', strokeStyle: 'dashed' },
    };
  });
  for (const [i, from, to, label] of [
    [0, 0, 1, '1 · Checkout'],
    [1, 1, 2, '2 · POST order'],
    [2, 2, 3, '3 · Insert order'],
    [3, 3, 2, '4 · Order ID'],
    [4, 2, 1, '5 · 201 Created'],
    [5, 1, 0, '6 · Confirmation'],
    [6, 2, 1, 'ALT · 409 Out of stock'],
  ] as const) {
    const id = `message-${i}`;
    d.connections[id] = {
      id,
      ownerId: 'sample',
      kind: 'arrow',
      z: 100,
      start: { kind: 'free', x: -390 + from * 260, y: -155 + i * 62 },
      end: { kind: 'free', x: -390 + to * 260, y: -155 + i * 62 },
      label,
      style: {
        stroke: i === 6 ? '#b45309' : '#475569',
        endArrowhead: 'arrow',
        ...(i >= 3 && i <= 5 ? { strokeStyle: 'dashed' } : {}),
      },
    };
  }
  return finish(
    d,
    'bundled-sequence',
    'Read an ordered checkout exchange with lifelines, responses and an alternative error.',
    [
      'Workflows & decisions',
      'sequence',
      'interaction',
      'UML',
      'request response',
    ],
    'Duplicate a message, move it down the lifelines, and edit its number. ALT shows an alternative response to request 2.',
  );
}
function decisionTree() {
  const d = sample('decision', 'Decision tree', 1100, 620);
  box(
    d,
    'question',
    'Production affected?',
    'Support triage begins here',
    0,
    -225,
    270,
    90,
    '#fef3c7',
  );
  box(d, 'impact', 'Multiple customers?', 'Assess scope', -280, -30, 240, 86);
  box(
    d,
    'blocked',
    'Work blocked?',
    'Check available workaround',
    280,
    -30,
    240,
    86,
  );
  for (const [id, name, text, x, fill] of [
    ['incident', 'Declare incident', 'Page incident lead', -420, '#fee2e2'],
    ['urgent', 'Urgent support', 'Assign on-call', -140, '#ffedd5'],
    ['standard', 'Standard support', 'Next business day', 140, '#dbeafe'],
    ['guide', 'Send guidance', 'Link a help article', 420, '#dcfce7'],
  ] as const)
    box(d, id, name, text, x, 205, 230, 90, fill);
  wire(d, 'question', 'impact', 'yes');
  wire(d, 'question', 'blocked', 'no');
  wire(d, 'impact', 'incident', 'yes');
  wire(d, 'impact', 'urgent', 'no');
  wire(d, 'blocked', 'standard', 'yes');
  wire(d, 'blocked', 'guide', 'no');
  return finish(
    d,
    'bundled-decision-tree',
    'Triage a support request through two decision levels to four distinct outcomes.',
    ['Workflows & decisions', 'decision tree', 'triage', 'support'],
    'Duplicate a question and its outcome; label each branch and keep every leaf actionable.',
  );
}

// Matrices use ordinary cells with no invented containment depth.
function matrix(
  id: string,
  title: string,
  columns: string[],
  rows: [string, string[]][],
) {
  const width = 220 + columns.length * 205,
    height = 170 + rows.length * 112;
  const d = sample(id, title, width, height);
  columns.forEach((name, c) =>
    box(
      d,
      `column-${c}`,
      name,
      '',
      -width / 2 + 310 + c * 205,
      -height / 2 + 70,
      195,
      54,
      '#dbeafe',
    ),
  );
  rows.forEach(([name, cells], r) => {
    const y = -height / 2 + 160 + r * 112;
    box(d, `row-${r}`, name, '', -width / 2 + 105, y, 180, 98, '#e2e8f0');
    cells.forEach((text, c) =>
      box(
        d,
        `cell-${r}-${c}`,
        '',
        text,
        -width / 2 + 310 + c * 205,
        y,
        195,
        98,
        r % 2 ? '#f0f9ff' : '#ffffff',
      ),
    );
  });
  return d;
}
function customerJourney() {
  const d = matrix(
    'journey',
    'Customer journey map',
    ['Discovery', 'Evaluation', 'Onboarding', 'Use', 'Support'],
    [
      [
        'Actions',
        [
          'Find refill shop',
          'Compare starter kits',
          'Create account',
          'Order first refill',
          'Track delayed parcel',
        ],
      ],
      [
        'Touchpoints',
        [
          'Search result',
          'Product page',
          'Signup + welcome',
          'Checkout + receipt',
          'Help chat',
        ],
      ],
      [
        'Pain points',
        [
          'Unclear coverage',
          'Sizes hard to compare',
          'Too many fields',
          'Delivery fee surprise',
          'Repeat order details',
        ],
      ],
      [
        'Opportunities',
        [
          'Show delivery area',
          'Add size comparison',
          'Ask only essentials',
          'Show total earlier',
          'Prefill order context',
        ],
      ],
    ],
  );
  return finish(
    d,
    'bundled-customer-journey',
    'Map a refill-shop customer from discovery to support, with pain points and opportunities.',
    ['Product & experience', 'customer journey', 'CX', 'UX', 'touchpoints'],
    'Duplicate a stage column or edit a row of cells; keep actions, pain points and opportunities about the same journey.',
  );
}
function serviceBlueprint() {
  const d = matrix(
    'blueprint',
    'Service blueprint',
    ['Book repair', 'Drop off', 'Repair', 'Collect'],
    [
      [
        'Customer actions',
        [
          'Choose time',
          'Describe fault',
          'Approve estimate',
          'Collect bicycle',
        ],
      ],
      [
        'Frontstage',
        [
          'Confirm booking',
          'Issue job ticket',
          'Send estimate → await customer approval',
          'Explain repair',
        ],
      ],
      [
        'Backstage',
        [
          'Reserve slot',
          'Inspect bicycle',
          'Replace worn chain',
          'Quality check',
        ],
      ],
      [
        'Support systems',
        ['Calendar', 'Job tracker', 'Parts inventory', 'Payment terminal'],
      ],
    ],
  );
  const boundaryY = d.objects['row-1'].geometry.y + 55;
  d.connections.visibility = {
    id: 'visibility',
    ownerId: 'sample',
    kind: 'line',
    z: 100,
    start: { kind: 'free', x: -495, y: boundaryY },
    end: { kind: 'free', x: 495, y: boundaryY },
    label: 'Line of visibility · frontstage above / backstage below',
    style: { stroke: '#b45309', strokeStyle: 'dashed' },
  };
  return finish(
    d,
    'bundled-service-blueprint',
    'Align a bicycle-repair journey with visible service, backstage work and supporting systems.',
    ['Product & experience', 'service blueprint', 'frontstage', 'backstage'],
    'Duplicate a journey column. Keep work below the visibility line aligned with the customer interaction it supports.',
  );
}
function sitemap() {
  const d = sample('sitemap', 'Sitemap / information architecture', 1100, 610);
  box(d, 'home', 'Home', 'Refill shop', 0, -235, 230, 70, '#dbeafe');
  for (const [id, name, x] of [
    ['shop', 'Shop', -360],
    ['account', 'Account', 0],
    ['help', 'Help', 360],
  ] as const) {
    box(d, id, name, 'Primary navigation', x, -70, 230, 76);
    wire(d, 'home', id, 'navigate');
  }
  for (const [id, name, parent, x] of [
    ['products', 'Products', 'shop', -460],
    ['bundles', 'Bundles', 'shop', -240],
    ['orders', 'Order history', 'account', 0],
    ['delivery', 'Delivery', 'help', 250],
    ['returns', 'Returns', 'help', 470],
  ] as const) {
    box(d, id, name, '', x, 100, 195, 66, '#ffffff');
    wire(d, parent, id, 'page');
  }
  box(
    d,
    'detail',
    'Product detail',
    'Ingredients / size / refill',
    -460,
    235,
    230,
    75,
    '#dcfce7',
  );
  wire(d, 'products', 'detail', 'detail');
  return finish(
    d,
    'bundled-sitemap',
    'Organize a shop into primary navigation, secondary pages and a product-detail branch.',
    [
      'Product & experience',
      'sitemap',
      'information architecture',
      'IA',
      'navigation',
    ],
    'Duplicate a page and connect it beneath its section. Arrows mean navigation, not required execution order.',
  );
}
function storyMap() {
  const d = matrix(
    'stories',
    'User story map',
    ['Set up account', 'Find product', 'Place order', 'Receive purchase'],
    [
      [
        'Activities',
        [
          'Join the shop',
          'Choose a refill',
          'Pay confidently',
          'Get the parcel',
        ],
      ],
      [
        'Release 1 · essentials',
        [
          'Email signup',
          'Browse products',
          'Card checkout',
          'Order confirmation',
        ],
      ],
      [
        'Release 2 · confidence',
        [
          'Saved preferences',
          'Compare sizes',
          'Saved address',
          'Shipment tracking',
        ],
      ],
      [
        'Later · convenience',
        [
          'Household account',
          'Refill suggestions',
          'Repeat order',
          'Delivery reminders',
        ],
      ],
    ],
  );
  return finish(
    d,
    'bundled-story-map',
    'Slice an account-to-first-purchase journey into useful releases.',
    ['Product & experience', 'user story map', 'agile', 'backbone', 'MVP'],
    'Duplicate an activity column or a task cell; move tasks between release rows to change the slice.',
  );
}
function roadmap() {
  const d = matrix(
    'roadmap',
    'Product roadmap',
    ['Now', 'Next', 'Later'],
    [
      [
        'Checkout',
        [
          'Transparent totals\nOutcome: fewer surprises',
          'Saved addresses\nOutcome: quicker repeat buys',
          'Subscriptions\nOutcome: easier refills',
        ],
      ],
      [
        'Trust',
        [
          'Delivery estimates\nOutcome: clear expectations',
          'Shipment tracking\nNeeds carrier events',
          'Proactive alerts\nDepends on tracking',
        ],
      ],
      [
        'Platform',
        [
          'Carrier event feed\nOwner: Integrations',
          'Reliable event storage\nOwner: Platform',
          'Self-service partners\nOwner: Platform',
        ],
      ],
    ],
  );
  return finish(
    d,
    'bundled-roadmap',
    'Plan outcomes across product areas using Now, Next and Later, with an explicit dependency.',
    ['Planning & teamwork', 'roadmap', 'Now Next Later', 'product strategy'],
    'Duplicate an initiative cell and edit its outcome and owner; write dependencies in the note. Dates are plain labels.',
  );
}
function kanban() {
  const d = sample('kanban', 'Kanban work board', 1190, 580);
  const columns = [
    ['Backlog', 'Ideas to refine'],
    ['Ready', 'WIP: 4'],
    ['In progress', 'WIP: 2'],
    ['Review', 'WIP: 2'],
    ['Done', 'Accepted'],
  ];
  columns.forEach(([name, note], i) => {
    const id = `lane-${i}`;
    box(
      d,
      id,
      `${name} · ${note}`,
      '',
      -460 + i * 230,
      -15,
      216,
      440,
      i === 4 ? '#f0fdf4' : '#eff6ff',
      'sample',
      'frame',
    );
  });
  for (const [id, name, text, lane, y] of [
    ['fees', 'Explain delivery fees', 'Mia · Draft clearer copy', 0, -100],
    ['sizes', 'Compare refill sizes', 'Leo · Acceptance notes ready', 1, -100],
    ['track', 'Track shipments', 'Sam · Wire carrier events', 2, -100],
    ['receipt', 'Receipt email', 'Jo · Check mobile layout', 3, -100],
    ['address', 'Address validation', 'Ari · Accepted by support', 4, -100],
    ['search', 'Improve search', 'Mia · Interview two shoppers', 0, 70],
  ] as const)
    box(d, id, name, text, 0, y, 192, 122, '#ffffff', `lane-${lane}`);
  return finish(
    d,
    'bundled-kanban',
    'Start a five-column work board with owners, notes and editable WIP limits.',
    ['Planning & teamwork', 'kanban', 'work board', 'tasks', 'WIP'],
    'Duplicate a card, edit its owner and next step, then reparent it into another column. WIP limits are text.',
  );
}
function organization() {
  const d = sample('organization', 'Organization / team chart', 1120, 620);
  box(
    d,
    'company',
    'Refill Shop',
    'Company-wide outcomes',
    0,
    -225,
    270,
    80,
    '#dbeafe',
  );
  for (const [id, name, x, fill] of [
    ['product', 'Product team', -340, '#eff6ff'],
    ['engineering', 'Engineering team', 0, '#f0fdf4'],
    ['operations', 'Operations team', 340, '#fffbeb'],
  ] as const) {
    box(d, id, name, '', x, 30, 290, 300, fill, 'sample', 'frame');
    wire(d, 'company', id, 'leads');
  }
  for (const [id, name, parent, y] of [
    ['pm', 'Product manager', 'product', -60],
    ['designer', 'Designer', 'product', 70],
    ['lead', 'Engineering lead', 'engineering', -60],
    ['developer', 'Developer', 'engineering', 70],
    ['ops', 'Operations lead', 'operations', -60],
    ['support', 'Support specialist', 'operations', 70],
  ] as const)
    box(
      d,
      id,
      name,
      'Role · duplicate to add people',
      0,
      y,
      250,
      88,
      '#ffffff',
      parent,
    );
  const collaboration = wire(d, 'designer', 'developer', 'collaboration', [
    { x: -340, y: 235 },
    { x: 0, y: 235 },
  ]);
  collaboration.style = {
    ...collaboration.style,
    strokeStyle: 'dashed',
    stroke: '#7c3aed',
  };
  return finish(
    d,
    'bundled-organization',
    'Show an organization, teams and roles, with a distinct dashed collaboration link.',
    ['Planning & teamwork', 'organization', 'org chart', 'team', 'reporting'],
    'Duplicate a team or role within its parent. Solid links show reporting; the dashed link shows collaboration.',
  );
}
function raci() {
  const d = matrix(
    'raci',
    'Responsibility matrix (RACI)',
    ['Product lead', 'Engineering', 'Operations', 'Support'],
    [
      ['Define scope', ['A / R', 'C', 'C', 'I']],
      ['Build change', ['A', 'R', 'C', 'I']],
      ['Approve release', ['A', 'C', 'R', 'I']],
      ['Deploy release', ['I', 'R', 'A', 'I']],
      ['Notify customers', ['A', 'I', 'C', 'R']],
    ],
  );
  return finish(
    d,
    'bundled-raci',
    'Assign four roles to five release activities, with one accountable owner per activity.',
    ['Planning & teamwork', 'RACI', 'responsibility', 'matrix', 'ownership'],
    'R = Responsible · A = Accountable · C = Consulted · I = Informed. Duplicate a row; keep one A per activity.',
  );
}
function mindMap() {
  const d = sample('mind-map', 'Mind map', 1160, 740);
  box(
    d,
    'topic',
    'Better first purchase',
    'Explore before choosing a solution',
    0,
    0,
    260,
    100,
    '#dbeafe',
  );
  for (const [id, name, text, x, y] of [
    ['trust', 'Trust', 'What would reassure shoppers?', -320, -140],
    ['choice', 'Choice', 'What helps comparison?', 320, -140],
    ['speed', 'Speed', 'Where do people hesitate?', -320, 150],
    ['support', 'Support', 'How do people get help?', 320, 150],
  ] as const) {
    box(d, id, name, text, x, y, 240, 92, '#fef3c7');
    wire(d, 'topic', id, name.toLowerCase());
  }
  for (const [id, name, text, parent, x, y] of [
    [
      'reviews',
      'Reviews',
      'Show recent verified purchases',
      'trust',
      -380,
      -285,
    ],
    ['sizes', 'Size guide', 'Compare everyday use', 'choice', 380, -285],
    [
      'guest',
      'Guest checkout',
      'Test fewer required fields',
      'speed',
      -380,
      285,
    ],
    [
      'chat',
      'Order-aware help',
      'Avoid repeating order details',
      'support',
      380,
      285,
    ],
  ] as const) {
    box(d, id, name, text, x, y, 265, 80, '#ffffff');
    wire(d, parent, id, 'idea');
  }
  return finish(
    d,
    'bundled-mind-map',
    'Explore four themes and a second level of ideas around improving a first purchase.',
    ['Strategy & workshops', 'mind map', 'brainstorm', 'ideas'],
    'Duplicate a theme or idea, connect it to its parent, and replace the question with one relevant to your topic.',
  );
}
function swot() {
  const d = sample('swot', 'SWOT analysis', 1060, 660);
  for (const [id, name, text, x, y, fill] of [
    [
      'strengths',
      'Strengths',
      'What works inside the business?',
      -250,
      -160,
      '#dcfce7',
    ],
    [
      'weaknesses',
      'Weaknesses',
      'What holds us back internally?',
      250,
      -160,
      '#fee2e2',
    ],
    [
      'opportunities',
      'Opportunities',
      'What external change can help?',
      -250,
      130,
      '#dbeafe',
    ],
    ['threats', 'Threats', 'What external risk matters?', 250, 130, '#fef3c7'],
  ] as const)
    box(d, id, name, text, x, y, 470, 260, fill, 'sample', 'frame');
  for (const [parent, a, b] of [
    ['strengths', 'Loyal local customers', 'Low packaging waste'],
    ['weaknesses', 'Manual stock counts', 'Limited delivery coverage'],
    ['opportunities', 'Office refill partnerships', 'Growing reuse interest'],
    ['threats', 'Delivery cost increases', 'Large retailers discounting'],
  ] as const) {
    box(
      d,
      `${parent}-1`,
      a,
      'Discuss evidence',
      0,
      -35,
      420,
      80,
      '#ffffff',
      parent,
    );
    box(
      d,
      `${parent}-2`,
      b,
      'Rate significance',
      0,
      65,
      420,
      80,
      '#ffffff',
      parent,
    );
  }
  return finish(
    d,
    'bundled-swot',
    'Assess a refill shop using internal strengths/weaknesses and external opportunities/threats.',
    ['Strategy & workshops', 'SWOT', 'strengths', 'weaknesses', 'strategy'],
    'Next actions: Mia validates office demand; Jo checks delivery costs. Duplicate a card and add evidence before prioritizing.',
  );
}
function prioritization() {
  const d = sample(
    'impact-effort',
    'Impact / effort prioritization',
    1060,
    660,
  );
  for (const [id, name, x, y, fill] of [
    ['quick', 'High impact · low effort', -240, -150, '#dcfce7'],
    ['invest', 'High impact · high effort', 240, -150, '#dbeafe'],
    ['small', 'Low impact · low effort', -240, 130, '#f1f5f9'],
    ['avoid', 'Low impact · high effort', 240, 130, '#fee2e2'],
  ] as const)
    box(d, id, name, '', x, y, 450, 260, fill, 'sample', 'frame');
  for (const [id, name, text, parent, x, y] of [
    [
      'fees',
      'Show total earlier',
      'Impact: high · effort: small',
      'quick',
      0,
      -40,
    ],
    [
      'email',
      'Clearer receipts',
      'Impact: medium · effort: small',
      'quick',
      0,
      60,
    ],
    [
      'tracking',
      'Live tracking',
      'Impact: high · effort: large',
      'invest',
      0,
      -40,
    ],
    [
      'repeat',
      'Repeat purchases',
      'Impact: high · effort: medium',
      'invest',
      0,
      60,
    ],
    ['icons', 'Refresh icons', 'Impact: low · effort: small', 'small', 0, 0],
    [
      'animation',
      'Custom animation',
      'Impact: low · effort: large',
      'avoid',
      0,
      0,
    ],
  ] as const)
    box(d, id, name, text, x, y, 390, 80, '#ffffff', parent);
  d.connections.impact = {
    id: 'impact',
    ownerId: 'sample',
    kind: 'arrow',
    z: 100,
    start: { kind: 'free', x: -490, y: 265 },
    end: { kind: 'free', x: -490, y: -290 },
    label: 'Impact ↑',
    style: { stroke: '#475569', endArrowhead: 'arrow' },
  };
  d.connections.effort = {
    id: 'effort',
    ownerId: 'sample',
    kind: 'arrow',
    z: 100,
    start: { kind: 'free', x: -460, y: 280 },
    end: { kind: 'free', x: 465, y: 280 },
    label: 'Effort →',
    style: { stroke: '#475569', endArrowhead: 'arrow' },
  };
  return finish(
    d,
    'bundled-impact-effort',
    'Position six initiatives by expected impact (higher upward) and effort (higher rightward).',
    [
      'Strategy & workshops',
      'impact effort',
      'prioritization',
      'quadrant',
      '2x2',
    ],
    'Axes: impact increases ↑; effort increases →. Move or duplicate an initiative, then discuss the evidence for its position.',
  );
}
function retrospective() {
  const d = sample('retro', 'Start / Stop / Continue retrospective', 1100, 640);
  for (const [id, name, x, fill] of [
    ['start', 'Start', -340, '#dbeafe'],
    ['stop', 'Stop', 0, '#fee2e2'],
    ['continue', 'Continue', 340, '#dcfce7'],
  ] as const)
    box(d, id, name, '', x, -80, 310, 360, fill, 'sample', 'frame');
  for (const [parent, a, b] of [
    ['start', 'Demo changes to support', 'Agree on release owner'],
    ['stop', 'Late scope additions', 'Manual status chasing'],
    ['continue', 'Pair on risky changes', 'Write short release notes'],
  ] as const) {
    box(
      d,
      `${parent}-1`,
      a,
      'Example observation',
      0,
      -70,
      280,
      100,
      '#ffffff',
      parent,
    );
    box(
      d,
      `${parent}-2`,
      b,
      'Discuss one recent example',
      0,
      70,
      280,
      100,
      '#ffffff',
      parent,
    );
  }
  box(
    d,
    'actions',
    'Action · Sam',
    'Next step: schedule a 15-minute support demo before Friday release. Check progress at the next retrospective.',
    0,
    220,
    990,
    105,
    '#fffbeb',
  );
  return finish(
    d,
    'bundled-retrospective',
    'Reflect on a delivery cycle and turn observations into an owned next step.',
    ['Strategy & workshops', 'retrospective', 'retro', 'start stop continue'],
    'Duplicate observations in each column; move agreed actions to the action area and name an owner plus the next step.',
  );
}
function incidentTimeline() {
  const d = sample('incident', 'Incident timeline & response', 1190, 650);
  for (const [id, name, text, x] of [
    [
      'detect',
      '09:05 · Detection',
      'Alert: checkout errors\nOwner: on-call',
      -460,
    ],
    [
      'triage',
      '09:10 · Triage',
      'Impact: 12% of orders\nOwner: incident lead',
      -230,
    ],
    [
      'mitigate',
      '09:20 · Mitigation',
      'Decision: revert release\nOwner: engineering',
      0,
    ],
    [
      'recover',
      '09:35 · Recovery',
      'Errors back to baseline\nOwner: operations',
      230,
    ],
    [
      'followup',
      'Next day · Follow-up',
      'Add regression coverage\nOwner: service team',
      460,
    ],
  ] as const)
    box(d, id, name, text, x, -140, 210, 150, '#eff6ff');
  for (const [a, b] of [
    ['detect', 'triage'],
    ['triage', 'mitigate'],
    ['mitigate', 'recover'],
    ['recover', 'followup'],
  ] as const)
    wire(d, a, b, 'then');
  box(
    d,
    'facts',
    'Facts',
    '09:02 release deployed. Error spike begins at 09:04. Rollback completed at 09:28.',
    -275,
    140,
    480,
    155,
    '#f0fdf4',
  );
  box(
    d,
    'questions',
    'Open questions',
    'Why did staging miss the error? Which customers need follow-up? Confirm before assigning a cause.',
    275,
    140,
    480,
    155,
    '#fffbeb',
  );
  return finish(
    d,
    'bundled-incident-timeline',
    'Record an incident chronologically with impact, decisions, owners, facts and open questions.',
    ['Operations & industry', 'incident', 'timeline', 'response', 'postmortem'],
    'Duplicate an event and edit its time, impact and owner. Keep verified facts separate from open questions.',
  );
}
function fishbone() {
  const d = sample(
    'fishbone',
    'Fishbone / cause-and-effect analysis',
    1180,
    650,
  );
  box(
    d,
    'problem',
    'Late deliveries',
    'Problem: 18% arrive after the promised date',
    455,
    0,
    200,
    110,
    '#fee2e2',
  );
  d.connections.spine = {
    id: 'spine',
    ownerId: 'sample',
    kind: 'arrow',
    z: 100,
    start: { kind: 'free', x: -540, y: 0 },
    end: { kind: 'object', objectId: 'problem', side: 'left', offset: 0.5 },
    style: { stroke: '#475569', endArrowhead: 'arrow' },
  };
  for (const [id, name, text, x, y, anchor] of [
    [
      'people',
      'People',
      'Hypothesis: unclear dispatch cover',
      -400,
      -210,
      -270,
    ],
    ['process', 'Process', 'Verified: batching adds one day', -100, -210, 30],
    [
      'technology',
      'Technology',
      'Hypothesis: stale carrier status',
      200,
      -210,
      330,
    ],
    [
      'materials',
      'Materials',
      'Verified: two packaging stockouts',
      -400,
      210,
      -270,
    ],
    [
      'measurement',
      'Measurement',
      'Hypothesis: promise date ignores cutoff',
      -100,
      210,
      30,
    ],
    [
      'environment',
      'Environment',
      'Hypothesis: carrier capacity peaks',
      200,
      210,
      330,
    ],
  ] as const) {
    box(d, id, name, text, x, y, 245, 112, y < 0 ? '#eff6ff' : '#fffbeb');
    d.connections[id] = {
      id,
      ownerId: 'sample',
      kind: 'line',
      z: 100,
      start: {
        kind: 'object',
        objectId: id,
        side: y < 0 ? 'bottom' : 'top',
        offset: 0.5,
      },
      end: { kind: 'free', x: anchor, y: 0 },
      style: { stroke: '#64748b' },
    };
  }
  return finish(
    d,
    'bundled-fishbone',
    'Explore six possible cause families for late deliveries while distinguishing hypotheses from verified evidence.',
    [
      'Operations & industry',
      'fishbone',
      'Ishikawa',
      'cause and effect',
      'root cause',
    ],
    'Duplicate a cause card and attach it to a branch; label each factor Hypothesis or Verified and record supporting evidence.',
  );
}
function valueStream() {
  const d = sample('value-stream', 'Value stream map', 1180, 600);
  for (const [id, name, text, x, y, fill] of [
    ['request', 'Request', 'Process: 5 min', -440, -170, '#eff6ff'],
    ['queue1', 'Order queue', 'Wait: 4 hours', -150, -170, '#fef3c7'],
    ['pick', 'Pick items', 'Process: 12 min', 150, -170, '#eff6ff'],
    [
      'queue2',
      'Packing queue',
      'Wait: 1 day · bottleneck',
      440,
      -170,
      '#fee2e2',
    ],
    ['pack', 'Pack order', 'Process: 8 min', 440, 100, '#eff6ff'],
    [
      'dispatch',
      'Dispatch',
      'Process: 4 min · carrier handoff',
      100,
      100,
      '#eff6ff',
    ],
    [
      'deliver',
      'Deliver',
      'Wait: 2 days · customer handoff',
      -280,
      100,
      '#dcfce7',
    ],
  ] as const)
    box(d, id, name, text, x, y, 220, 100, fill);
  for (const [a, b, label] of [
    ['request', 'queue1', 'accept'],
    ['queue1', 'pick', 'release'],
    ['pick', 'queue2', 'handoff'],
    ['queue2', 'pack', 'pull'],
    ['pack', 'dispatch', 'handoff'],
    ['dispatch', 'deliver', 'carrier'],
  ] as const)
    wire(d, a, b, label);
  return finish(
    d,
    'bundled-value-stream',
    'Map request-to-delivery work, queues and example processing/wait times around a packing bottleneck.',
    ['Operations & industry', 'value stream', 'VSM', 'lean', 'wait time'],
    'Improvement idea: trial two packing runs daily. Duplicate a step or queue and edit its process/wait time; no totals are calculated.',
  );
}

export const templateCategories = [
  'Architecture & data',
  'Infrastructure & delivery',
  'Workflows & decisions',
  'Product & experience',
  'Planning & teamwork',
  'Strategy & workshops',
  'Operations & industry',
];
export const bundledTemplates = [
  erd(),
  infrastructure(),
  purdue(),
  systemContext(),
  applicationArchitecture(),
  dataPipeline(),
  cloudTopology(),
  networkZones(),
  deliveryPipeline(),
  processFlow(),
  swimlane(),
  sequence(),
  decisionTree(),
  customerJourney(),
  serviceBlueprint(),
  sitemap(),
  storyMap(),
  roadmap(),
  kanban(),
  organization(),
  raci(),
  mindMap(),
  swot(),
  prioritization(),
  retrospective(),
  incidentTimeline(),
  fishbone(),
  valueStream(),
];
