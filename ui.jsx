/* global React, window */
const { useState } = React;

// ---------------- ICONS (simple stroke glyphs) ----------------
const P = (d, k) => React.createElement("path", { d, key: k });
const ICONS = {
  upload: ["M12 3v13", "m7 8 5-5 5 5", "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"],
  link: ["M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.1", "M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.1"],
  file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 13h6", "M9 17h6"],
  github: ["M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6 0C6.7 2.3 5.6 2.6 5.6 2.6a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"],
  cube: ["m21 16-9 5-9-5V8l9-5 9 5z", "M12 21V12", "m3.3 7 8.7 5 8.7-5"],
  terminal: ["m4 17 6-6-6-6", "M12 19h8"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "M12 8v4", "M12 16h.01"],
  alert: ["m10.3 3.9-8.5 14.7A1 1 0 0 0 2.7 20h18.6a1 1 0 0 0 .9-1.4L13.7 3.9a1 1 0 0 0-1.7 0z", "M12 9v4", "M12 17h.01"],
  branch: ["M6 3v12", "M18 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0z", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M15 9a9 9 0 0 1-9 9"],
  cpu: ["M6 6h12v12H6z", "M9 9h6v6H9z", "M9 1v3", "M15 1v3", "M9 20v3", "M15 20v3", "M20 9h3", "M20 14h3", "M1 9h3", "M1 14h3"],
  send: ["M22 2 11 13", "M22 2 15 22l-4-9-9-4z"],
  check: ["M20 6 9 17l-5-5"],
  chevR: ["m9 18 6-6-6-6"],
  chevD: ["m6 9 6 6 6-6"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  plus: ["M12 5v14", "M5 12h14"],
  copy: ["M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
  ext: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  layers: ["m12 2 9 5-9 5-9-5 9-5z", "m3 12 9 5 9-5", "m3 17 9 5 9-5"],
  play: ["M7 4v16l13-8z"],
  loader: ["M21 12a9 9 0 1 1-6.2-8.5"],
  replay: ["M3 11a8 8 0 1 0 2.3-5.7", "M3 4v4h4"],
  spark: ["M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"],
  package2: ["M16.5 9.4 7.5 4.2", "M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z", "M3.3 7 12 12l8.7-5", "M12 22V12"],
  doc: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3"],
  sliders: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  flask: ["M9 3h6", "M10 3v6.6L4.7 18A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.7-3L14 9.6V3", "M7.5 15h9"],
  dot: ["M12 12h.01"],
};
function Icon({ name, size = 16, sw = 1.7, cls = "", style }) {
  const d = ICONS[name] || ICONS.dot;
  return React.createElement("svg", {
    className: "ic " + cls, width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: sw,
    strokeLinecap: "round", strokeLinejoin: "round", style,
  }, d.map((dd, i) => P(dd, i)));
}

// ---------------- primitives ----------------
function Tag({ kind = "neutral", icon, children }) {
  return (
    <span className={"tag tag-" + kind}>
      {icon && <Icon name={icon} size={12} sw={2} />}
      {children}
    </span>
  );
}

function Btn({ variant = "ghost", sm, icon, iconR, children, ...rest }) {
  const cls = ["btn", "btn-" + variant, sm && "btn-sm", !children && "btn-icon"].filter(Boolean).join(" ");
  return (
    <button className={cls} {...rest}>
      {icon && <Icon name={icon} size={sm ? 14 : 15} sw={1.9} />}
      {children}
      {iconR && <Icon name={iconR} size={sm ? 14 : 15} sw={1.9} />}
    </button>
  );
}

function Panel({ title, icon, sub, right, children, pad = true }) {
  return (
    <div className="panel">
      {(title || right) && (
        <div className="panel-head">
          {title && (
            <div className="panel-title">
              {icon && <Icon name={icon} size={15} sw={1.8} style={{ color: "var(--accent-ink)" }} />}
              {title}
            </div>
          )}
          {sub && <div className="panel-sub">{sub}</div>}
          <div className="spacer" />
          {right}
        </div>
      )}
      <div style={pad ? { padding: "14px 16px" } : null}>{children}</div>
    </div>
  );
}

function CopyBtn({ getText }) {
  const [done, setDone] = useState(false);
  return (
    <Btn sm icon={done ? "check" : "copy"} onClick={() => {
      try { navigator.clipboard.writeText(getText ? getText() : ""); } catch (e) {}
      setDone(true); setTimeout(() => setDone(false), 1400);
    }}>{done ? "Copied" : "Copy"}</Btn>
  );
}

Object.assign(window, { Icon, Tag, Btn, Panel, CopyBtn });
