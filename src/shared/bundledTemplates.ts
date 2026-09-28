import {
  createRecursiveDocument,
  type Geometry,
  type RecursiveDocument,
} from './recursiveDocument';
import { editNamedView } from './namedViews';
import { createTemplate, type TemplateManifest } from './templates';

const guidance =
  'Choose a component in Templates, select its destination, then Add component. Rename the new item and edit its content. Use the child toggle to collapse or expand independently. Capture a bookmark after arranging your new instance.';
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
function bookmark(
  document: RecursiveDocument,
  root: string,
  name: string,
  depth: number,
  focus = { x: 0, y: 0 },
  scale = 0.65,
) {
  document.rootDepths[root] = depth;
  editNamedView(
    {
      type: 'create',
      id: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
      name,
    },
    { x: 500 - focus.x * scale, y: 350 - focus.y * scale, scale },
    { width: 1000, height: 700 },
  )(document);
}
function component(
  rootId: string,
  name: string,
  parentRole: string,
  hint: string,
) {
  return { id: rootId, rootId, name, parentRole, guidance: hint };
}
function finish(
  document: RecursiveDocument,
  id: string,
  description: string,
  tags: string[],
  components: TemplateManifest['components'],
) {
  document.rootDepths[Object.keys(document.rootDepths)[0]] = 1;
  const template = createTemplate(document, {
    formatVersion: 1,
    id,
    version: 1,
    name: document.metadata.title,
    description,
    tags,
    guidance,
    components,
    excludedConnections: [],
  });
  // Bundled sources must compare identically after save/reopen and repeated insertion.
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
    'Schema overview. Expand to inspect tables; choose Table detail for columns. Add tables under this database and columns under a table.',
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
  bookmark(d, 'database', 'Overview', 1);
  bookmark(d, 'database', 'Table detail', 2, { x: -260, y: 0 }, 1.2);
  return finish(
    d,
    'bundled-erd',
    'An editable database, tables, columns and a labeled foreign-key relationship.',
    ['database', 'ERD', 'SQL'],
    [
      component(
        'customers',
        'Table',
        'Database / schema',
        'Use plural snake_case, then add columns. Reconnect foreign keys after insertion.',
      ),
      component(
        'customers-column-0',
        'Column',
        'Table',
        'Use name · type · PK/FK · NULL/NOT NULL. Rename id when adding a non-key column.',
      ),
    ],
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
  bookmark(d, 'site', 'Overview', 1);
  bookmark(d, 'site', 'Rack detail', 2);
  bookmark(d, 'site', 'Ports and services', 3, { x: 0, y: 0 }, 0.85);
  return finish(
    d,
    'bundled-isometric',
    'A site, rack, server, switch and ports arranged on an isometric rack plane using editable 2D shapes.',
    ['network', 'infrastructure', 'isometric'],
    [
      component(
        'rack',
        'Rack and connection',
        'Site / environment',
        'Rename zone and rack; the internal server-to-switch link is copied with the rack.',
      ),
      component(
        'server',
        'Server',
        'Rack / network zone',
        'Use environment-zone-role-number. Edit resource notes and add ports.',
      ),
      component(
        'switch',
        'Switch',
        'Rack / network zone',
        'Name the switch and document VLANs, then add uplinks.',
      ),
      component(
        'port',
        'Port / service',
        'Device',
        'Name the interface or service; document protocol, port, VLAN and peer.',
      ),
    ],
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
  bookmark(d, 'plant', 'Overview', 1, { x: 0, y: 0 }, 0.34);
  bookmark(d, 'plant', 'Operations', 2, { x: 0, y: 0 }, 0.52);
  bookmark(d, 'plant', 'Device detail', 3, { x: -190, y: 440 }, 1.1);
  bookmark(d, 'plant', 'IT-OT boundary', 2, { x: 0, y: -440 }, 0.7);
  return finish(
    d,
    'bundled-purdue',
    'A functional IT/OT architecture with peer levels 0–4, an optional DMZ band and labeled information/control flows.',
    ['ISA-95', 'Purdue', 'industrial', 'IT/OT'],
    [
      component(
        'level1',
        'Level / area',
        'Site / system',
        'Rename the functional level or area. Level labels are independent of D0/D1 disclosure.',
      ),
      component(
        'plc',
        'Controller / device and control link',
        'Level / area',
        'Name site-area-controller-number. The sensor, actuator and internal control connection are included.',
      ),
      component(
        'mes',
        'Application',
        'Level / area',
        'Name the application and document function, owner and exchanges. Reconnect cross-level flows explicitly.',
      ),
      component(
        'dmz',
        'Optional industrial DMZ',
        'Site / system',
        '3.5 is a common Purdue network-security adaptation, not an ISA-95 functional level.',
      ),
    ],
  );
}
export const bundledTemplates = [erd(), infrastructure(), purdue()];
