// Inventory of everything in a Flutter app that analytics must cover:
// routes, modals, screens, user actions, state-management handlers, user models,
// plus whether the analytics scaffold itself is in place.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { classAt, classes, enclosingCall, expressionEnd, findFunctionBody, lineOf, matchBracket, readDart, snake, walkDart } from './dart.mjs';

export const TRACK_RE = /\bAnalytics\s*\.\s*(?:track|logEvent)\s*\(/;
const IGNORE_RE = /analytics:ignore\b[ \t]*(.*)$/;

const WIDGET_BASE = /^(StatelessWidget|StatefulWidget|ConsumerWidget|ConsumerStatefulWidget|HookWidget|HookConsumerWidget|StatefulHookConsumerWidget|GetView|GetWidget)\b/;
const STATE_BASE = /^(?:State|ConsumerState)<\s*(\w+)\s*>/;
const BLOC_BASE = /^(Bloc|HydratedBloc|ReplayBloc)</;
const LOGIC_BASE = /^(Cubit|HydratedCubit|StateNotifier|Notifier|AutoDisposeNotifier|AsyncNotifier|AutoDisposeAsyncNotifier|ChangeNotifier|GetxController|Store)\b/;
const SCAFFOLD_RE = /\b(?:Scaffold|CupertinoPageScaffold|CupertinoTabScaffold)\s*\(/;
const SCREEN_NAME = /(Screen|Page)$/;
const MODAL_NAME = /(Sheet|Dialog|Popup|Modal)$/;

const HANDLERS = [
  'onPressed', 'onTap', 'onLongPress', 'onDoubleTap', 'onChanged', 'onSubmitted', 'onFieldSubmitted', 'onSelected', 'onDismissed',
  'onRefresh', 'onToggle', 'onConfirm', 'onDestinationSelected', 'onSelectionChanged', 'onPageChanged', 'onReorder', 'onDeleted',
  'onStepTapped', 'onStepContinue', 'onStepCancel', 'onRatingUpdate', 'onAccept',
];
const HANDLER_RE = new RegExp(`(?<![\\w.])(${HANDLERS.join('|')})\\s*:`, 'g');
const TEXT_INPUTS = new Set(['TextField', 'TextFormField', 'CupertinoTextField', 'CupertinoSearchTextField', 'SearchBar', 'EditableText', 'Autocomplete']);
const TOGGLES = new Set(['Switch', 'SwitchListTile', 'Checkbox', 'CheckboxListTile', 'CupertinoSwitch', 'Radio', 'RadioListTile', 'ToggleButtons', 'ChoiceChip', 'FilterChip']);
const VERBS = {
  onPressed: 'tapped', onTap: 'tapped', onLongPress: 'long_pressed', onDoubleTap: 'double_tapped', onChanged: 'changed', onSubmitted: 'submitted',
  onFieldSubmitted: 'submitted', onSelected: 'selected', onDismissed: 'dismissed', onRefresh: 'refreshed', onToggle: 'toggled', onConfirm: 'confirmed',
  onDestinationSelected: 'tab_selected', onSelectionChanged: 'selection_changed', onPageChanged: 'page_changed', onReorder: 'reordered', onDeleted: 'deleted',
  onStepTapped: 'step_tapped', onStepContinue: 'step_continued', onStepCancel: 'step_cancelled', onRatingUpdate: 'rated', onAccept: 'accepted',
};
const NOT_FUNCTIONS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'setState', 'print', 'debugPrint', 'assert', 'super', 'this']);

const MODAL_RE = /(?<![\w.])(showModalBottomSheet|showDialog|showCupertinoModalPopup|showCupertinoDialog|showGeneralDialog|showBarModalBottomSheet|showMaterialModalBottomSheet|showCupertinoModalBottomSheet|showAdaptiveDialog)\s*(?:<[^<>()]*(?:<[^<>()]*>)?[^<>()]*>)?\s*\(/g;
const IMPERATIVE_ROUTE_RE = /(?<![\w.])(MaterialPageRoute|CupertinoPageRoute|PageRouteBuilder|MaterialWithModalsPageRoute|CupertinoModalPopupRoute)\s*(?:<[^<>()]*(?:<[^<>()]*>)?[^<>()]*>)?\s*\(/g;

/** Named arguments directly inside a call: Map name → { start, end } (value range, exclusive end). */
export function namedArgs(mask, open, close) {
  const out = new Map();
  let depth = 0;
  let segStart = open + 1;
  const flush = (segEnd) => {
    const m = /^\s*(\w+)\s*:/.exec(mask.slice(segStart, segEnd));
    if (m) out.set(m[1], { start: segStart + m[0].length, end: segEnd });
  };
  for (let i = open + 1; i < close; i++) {
    const ch = mask[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      flush(i);
      segStart = i + 1;
    }
  }
  flush(close);
  return out;
}

function widgetNames(maskText) {
  const out = new Set();
  for (const m of maskText.matchAll(/(?<![\w.])(?:const\s+)?([A-Z]\w+)\s*(?:<[^<>()]*>)?\s*\(/g)) out.add(m[1]);
  return [...out];
}

function resolveValue(file, range, constants) {
  let raw = file.code.slice(range.start, range.end).trim();
  // `settings: const RouteSettings(name: 'x')` — the interesting part is the name.
  const settings = /RouteSettings\s*\(([\s\S]*)\)/.exec(raw);
  if (settings) {
    const named = /\bname\s*:\s*([^,)]+)/.exec(settings[1]);
    if (!named) return raw;
    raw = named[1].trim();
  }
  const str = /^(?:const\s+)?r?(['"])([\s\S]*)\1$/.exec(raw);
  if (str) return str[2];
  if (constants.has(raw)) return constants.get(raw);
  const last = raw.split('.').pop();
  return constants.get(last) ?? raw;
}

function ignoreReason(file, index) {
  const line = lineOf(file.src, index);
  const lines = file.src.split('\n');
  for (const candidate of [lines[line - 1], lines[line - 2]]) {
    const m = candidate ? IGNORE_RE.exec(candidate) : null;
    if (m) return m[1].trim() || 'ignored';
  }
  return null;
}

function labelFor(file, call) {
  if (!call || call.close === -1) return null;
  const text = file.code.slice(call.open, Math.min(call.close, call.open + 1500));
  const patterns = [
    /\bText\(\s*(?:const\s+)?(['"])([^'"$]{1,40})\1/,
    /\b(?:label|tooltip|title|hintText|labelText|semanticLabel|text|message)\s*:\s*(?:const\s+)?(?:Text\(\s*)?(['"])([^'"$]{1,40})\1/,
    /\b(?:t|context\.t|l10n|context\.l10n|S\.of\(context\)|AppLocalizations\.of\(context\)!?)\.(?:[\w]+\.)*(\w+)/,
    /\bIcons\.(\w+)/,
    /\bCupertinoIcons\.(\w+)/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return snake(m[2] ?? m[1]).split('_').filter(Boolean).slice(0, 3).join('_');
  }
  return null;
}

/** Join name parts into <= 40 chars: drop label words first, then prefix words; the verb always survives. */
export function fitName(prefix, label, verb, max = 40) {
  const p = String(prefix ?? '').split('_').filter(Boolean);
  const l = String(label ?? '').split('_').filter(Boolean);
  const join = () => [...p, ...l, verb].filter(Boolean).join('_');
  while (join().length > max && l.length > 1) l.pop();
  while (join().length > max && p.length > 1) p.shift();
  while (join().length > max && l.length > 0) l.pop();
  return join().slice(0, max).replace(/_+$/, '');
}

const normalizeEvent = (s) => String(s).split('.').pop().replace(/^_+/, '').toLowerCase().replace(/event$/, '');

export function scanProject(root) {
  const files = walkDart(root).map((rel) => readDart(root, rel));
  const pubspec = existsSync(path.join(root, 'pubspec.yaml')) ? readFileSync(path.join(root, 'pubspec.yaml'), 'utf8') : '';
  const hasDep = (name) => new RegExp(`^\\s{2}${name}\\s*:`, 'm').test(pubspec);

  // ---- pass 1: constants, classes, logic handlers -------------------------------------------
  const constants = new Map();
  const classIndex = new Map(); // class name → { file, cls }
  for (const file of files) {
    file.classes = classes(file.mask);
    for (const cls of file.classes) {
      classIndex.set(cls.name, { file, cls });
      const body = file.code.slice(cls.bodyOpen, cls.bodyClose);
      for (const m of body.matchAll(/static\s+const\s+(?:String\s+)?(\w+)\s*=\s*(['"])([^'"]*)\2/g)) {
        constants.set(`${cls.name}.${m[1]}`, m[3]);
        if (!constants.has(m[1])) constants.set(m[1], m[3]);
      }
    }
    for (const m of file.code.matchAll(/^(?:const|final)\s+(?:String\s+)?(\w+)\s*=\s*(['"])([^'"]*)\2\s*;/gm)) if (!constants.has(m[1])) constants.set(m[1], m[3]);
  }

  const blocs = [];
  for (const file of files) {
    for (const cls of file.classes) {
      const isBloc = BLOC_BASE.test(cls.extends);
      const isLogic = LOGIC_BASE.test(cls.extends) || /\bwith\s+[^{]*ChangeNotifier/.test(cls.rest);
      if (!isBloc && !isLogic) continue;
      const handlers = [];
      const body = file.mask.slice(cls.bodyOpen, cls.bodyClose);
      if (isBloc) {
        for (const m of body.matchAll(/\bon<\s*([\w.]+)\s*>\s*\(/g)) {
          const open = cls.bodyOpen + m.index + m[0].length - 1;
          const close = matchBracket(file.mask, open);
          const arg = file.mask.slice(open + 1, close === -1 ? open + 1 : close);
          const ident = /^\s*(_?\w+)\s*(?:,|$)/.exec(arg);
          let instrumented = TRACK_RE.test(arg);
          if (!instrumented && ident) {
            const fn = findFunctionBody(file.mask, ident[1], cls.bodyOpen, cls.bodyClose);
            instrumented = fn ? TRACK_RE.test(file.mask.slice(fn.start, fn.end)) : false;
          }
          handlers.push({ event: m[1], line: lineOf(file.src, open), instrumented });
        }
      } else {
        const re = /(?:^|\n)\s*(?:@override\s+)?(?:Future(?:<[^>]*>)?|void|bool|int|double|String)\s+([a-z]\w*)\s*\(/g;
        for (const m of body.matchAll(re)) {
          if (['build', 'dispose', 'close', 'onChange', 'onError', 'onTransition', 'onInit', 'onReady', 'onClose', 'toString', 'updateShouldNotify'].includes(m[1])) continue;
          const fn = findFunctionBody(file.mask, m[1], cls.bodyOpen + m.index, cls.bodyClose);
          handlers.push({ event: m[1], line: lineOf(file.src, cls.bodyOpen + m.index + m[0].length), instrumented: fn ? TRACK_RE.test(file.mask.slice(fn.start, fn.end)) : false });
        }
      }
      blocs.push({ file: file.rel, class: cls.name, kind: isBloc ? 'bloc' : 'logic', handlers });
    }
  }
  const blocByClass = new Map(blocs.map((b) => [b.class, b]));

  // ---- pass 2: routes, modals, screens, actions ---------------------------------------------
  const routes = [];
  const modals = [];
  const actions = [];
  const excluded = [];
  const namedRouteWidgets = new Set();

  for (const file of files) {
    const { mask } = file;

    for (const m of mask.matchAll(/(?<![\w.])GoRoute\s*\(/g)) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(mask, open);
      if (close === -1) continue;
      const args = namedArgs(mask, open, close);
      const builder = args.get('builder') ?? args.get('pageBuilder');
      const widgets = builder ? widgetNames(mask.slice(builder.start, builder.end)) : [];
      const hasName = args.has('name');
      if (hasName) widgets.forEach((w) => namedRouteWidgets.add(w));
      routes.push({
        kind: 'go_route', file: file.rel, line: lineOf(file.src, m.index),
        path: args.has('path') ? resolveValue(file, args.get('path'), constants) : null,
        name: hasName ? resolveValue(file, args.get('name'), constants) : null,
        hasName, widgets, ignored: ignoreReason(file, m.index),
      });
    }

    for (const m of mask.matchAll(IMPERATIVE_ROUTE_RE)) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(mask, open);
      if (close === -1) continue;
      const args = namedArgs(mask, open, close);
      const settings = args.get('settings');
      const hasName = !!settings && /\bname\s*:/.test(mask.slice(settings.start, settings.end));
      const builder = args.get('builder') ?? args.get('pageBuilder');
      const widgets = builder ? widgetNames(mask.slice(builder.start, builder.end)) : [];
      if (hasName) widgets.forEach((w) => namedRouteWidgets.add(w));
      routes.push({ kind: 'imperative', file: file.rel, line: lineOf(file.src, m.index), path: null, name: hasName ? resolveValue(file, settings, constants).slice(0, 80) : null, hasName, widgets, ignored: ignoreReason(file, m.index) });
    }

    // Named-routes table on MaterialApp & friends: every entry is named by construction.
    for (const m of mask.matchAll(/(?<![\w.])(?:MaterialApp|CupertinoApp|GetMaterialApp|WidgetsApp)\s*\(/g)) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(mask, open);
      if (close === -1) continue;
      const table = namedArgs(mask, open, close).get('routes');
      if (!table) continue;
      const text = file.code.slice(table.start, table.end);
      for (const e of text.matchAll(/(['"])(\/[^'"]*)\1\s*:/g)) routes.push({ kind: 'named_table', file: file.rel, line: lineOf(file.src, table.start + e.index), path: e[2], name: e[2], hasName: true, widgets: [], ignored: null });
      widgetNames(mask.slice(table.start, table.end)).forEach((w) => namedRouteWidgets.add(w));
    }

    // auto_route pages are named by the generated router.
    for (const m of mask.matchAll(/@RoutePage\s*\([^)]*\)\s*class\s+(\w+)/g)) {
      namedRouteWidgets.add(m[1]);
      routes.push({ kind: 'auto_route', file: file.rel, line: lineOf(file.src, m.index), path: null, name: m[1], hasName: true, widgets: [m[1]], ignored: null });
    }

    for (const m of mask.matchAll(MODAL_RE)) {
      // Skip declarations such as `Future<T?> showAppSheet<T>(...) {`
      if (/(?:Future(?:<[^;{}]*>)?|void)\s*$/.test(mask.slice(Math.max(0, m.index - 40), m.index))) continue;
      const open = m.index + m[0].length - 1;
      const close = matchBracket(mask, open);
      if (close === -1) continue;
      const args = namedArgs(mask, open, close);
      const settings = args.get('routeSettings');
      const builder = args.get('builder') ?? args.get('pageBuilder');
      modals.push({
        kind: m[1], file: file.rel, line: lineOf(file.src, m.index),
        hasRouteSettings: !!settings,
        name: settings ? resolveValue(file, settings, constants).slice(0, 80) : null,
        widgets: builder ? widgetNames(mask.slice(builder.start, builder.end)).filter((w) => !['Text', 'Padding', 'SizedBox', 'Column', 'Row', 'Builder'].includes(w)).slice(0, 3) : [],
        ignored: ignoreReason(file, m.index),
      });
    }

    for (const m of mask.matchAll(HANDLER_RE)) {
      const handler = m[1];
      let start = m.index + m[0].length;
      while (start < mask.length && /\s/.test(mask[start])) start++;
      // A named *parameter declaration* (`{this.onTap}` / `VoidCallback? onTap,`) is not an action.
      const end = expressionEnd(mask, start);
      const expr = mask.slice(start, end).trim();
      if (expr === '' || expr === 'null') continue;
      // `onTap:` only counts as an action when it is an argument of a call (a widget being built).
      const call = enclosingCall(mask, m.index);
      if (!call || !call.name) continue;
      const cls = classAt(file.classes, m.index);
      const owner = cls ? (STATE_BASE.exec(cls.extends)?.[1] ?? cls.name) : null;
      const widget = call.name;
      const base = { file: file.rel, line: lineOf(file.src, m.index), handler, widget, class: owner };

      const reason = ignoreReason(file, m.index);
      if (reason) {
        excluded.push({ ...base, why: `analytics:ignore ${reason}` });
        continue;
      }
      if (/^(?:widget\.)?(?:on[A-Z]\w*|\w*[cC]allback|\w*Handler)$/.test(expr)) {
        excluded.push({ ...base, why: `pass-through of ${expr} — instrument the call site that supplies it` });
        continue;
      }
      if (handler === 'onChanged' && TEXT_INPUTS.has(widget)) {
        excluded.push({ ...base, why: 'per-keystroke text change — track onSubmitted or the form submit instead (PII + noise)' });
        continue;
      }

      let instrumented = TRACK_RE.test(expr);
      let via = instrumented ? 'inline' : null;
      const delegates = [];

      if (!instrumented) {
        const names = new Set();
        const bare = /^(?:widget\.|this\.)?(_?[a-zA-Z]\w*)$/.exec(expr);
        if (bare) names.add(bare[1]);
        for (const c of expr.matchAll(/(?<![\w.])(_?[a-zA-Z]\w*)\s*\(/g)) if (!NOT_FUNCTIONS.has(c[1]) && !/^[A-Z]/.test(c[1])) names.add(c[1]);
        for (const name of names) {
          const fn = (cls && findFunctionBody(mask, name, cls.bodyOpen, cls.bodyClose)) || findFunctionBody(mask, name);
          if (!fn) continue;
          delegates.push(name);
          if (TRACK_RE.test(mask.slice(fn.start, fn.end))) {
            instrumented = true;
            via = `${name}()`;
            break;
          }
        }
      }

      if (!instrumented) {
        // State-management dispatch: follow `.add(Event)` / `read<X>().method()` to the handler.
        const target = /(?:read|watch|of)<\s*(\w+)\s*>/.exec(expr)?.[1] ?? null;
        const candidates = target && blocByClass.has(target) ? [blocByClass.get(target)] : blocs;
        const added = /\.add\(\s*(?:const\s+)?([\w.]+)/.exec(expr);
        const called = [...expr.matchAll(/\.\s*([a-z]\w*)\s*\(/g)].map((c) => c[1]).filter((n) => !['add', 'read', 'watch', 'of', 'pop', 'push', 'go', 'then', 'unfocus', 'toString'].includes(n));
        for (const b of candidates) {
          const hit = b.handlers.find((h) => {
            if (added && b.kind === 'bloc') {
              const a = normalizeEvent(added[1]);
              const e = normalizeEvent(h.event);
              return a !== '' && (a === e || e.endsWith(a) || a.endsWith(e));
            }
            return b.kind === 'logic' && called.includes(h.event);
          });
          if (hit) {
            delegates.push(`${b.class}.${hit.event}`);
            if (hit.instrumented) {
              instrumented = true;
              via = `${b.class}.${hit.event}`;
              break;
            }
          }
        }
      }

      const label = labelFor(file, call);
      const prefix = snake((owner ?? path.basename(file.rel, '.dart')).replace(/^_+/, '').replace(/(Screen|Page|View|Widget|State)$/, ''));
      const verb = handler === 'onChanged' && TOGGLES.has(widget) ? 'toggled' : VERBS[handler];
      const suggested = fitName(prefix, label, verb);
      actions.push({ ...base, label, instrumented, via, delegates, suggested });
    }
  }

  // ---- screens -------------------------------------------------------------------------------
  // A widget that owns a Scaffold but is constructed by several other classes is a layout
  // wrapper (AppScaffold, MainBody…), not a screen of its own.
  const usedBy = new Map();
  for (const file of files) {
    for (const m of file.mask.matchAll(/(?<![\w.])(?:const\s+)?([A-Z]\w+)\s*(?:<[^<>()]*>)?\s*\(/g)) {
      const user = classAt(file.classes, m.index);
      if (!user) continue;
      const owner = STATE_BASE.exec(user.extends)?.[1] ?? user.name;
      if (owner === m[1]) continue;
      if (!usedBy.has(m[1])) usedBy.set(m[1], new Set());
      usedBy.get(m[1]).add(owner);
    }
  }

  const screens = [];
  const seen = new Set();
  for (const file of files) {
    for (const cls of file.classes) {
      const stateOf = STATE_BASE.exec(cls.extends)?.[1];
      const isWidget = WIDGET_BASE.test(cls.extends);
      if (!stateOf && !isWidget) continue;
      const name = stateOf ?? cls.name;
      if (MODAL_NAME.test(name)) continue;
      const body = file.mask.slice(cls.bodyOpen, cls.bodyClose);
      const looksLikeScreen = SCAFFOLD_RE.test(body) || SCREEN_NAME.test(name);
      if (!looksLikeScreen || seen.has(name)) continue;
      if (!SCREEN_NAME.test(name) && (usedBy.get(name)?.size ?? 0) >= 2) continue;
      const owner = classIndex.get(name);
      const allBodies = [body, owner ? owner.file.mask.slice(owner.cls.bodyOpen, owner.cls.bodyClose) : ''].join('\n');
      const routed = namedRouteWidgets.has(name);
      const hasShownEvent = /\bAnalytics\s*\.\s*(?:track|logEvent|trackScreenView)\s*\(/.test(allBodies) && /(?:Shown|Viewed|Opened|_shown|_viewed|_opened|trackScreenView)/.test(allBodies);
      const reason = ignoreReason(owner?.file ?? file, (owner?.cls ?? cls).start);
      seen.add(name);
      screens.push({ file: (owner?.file ?? file).rel, class: name, routed, hasShownEvent, covered: routed || hasShownEvent, ignored: reason, suggested: `${snake(name.replace(/^_+/, '').replace(/(Screen|Page|View)$/, ''))}_shown` });
    }
  }

  // ---- user models ---------------------------------------------------------------------------
  const NOT_MODEL = /(Screen|Page|View|Widget|Bloc|Cubit|State|Event|Repository|Repo|Service|Api|Client|Provider|Notifier|Controller|Manager|Storage|Mapper|Sync|Test|Dialog|Sheet|Card|Tile|Item|Header|Avatar|Button|Form|Field|Picker|Request|Exception|Module|Interceptor)$/;
  const userModels = [];
  for (const file of files) {
    for (const cls of file.classes) {
      if (!/(User|Profile|Account|Member|Customer)/.test(cls.name) || NOT_MODEL.test(cls.name) || WIDGET_BASE.test(cls.extends) || STATE_BASE.test(cls.extends)) continue;
      const body = file.mask.slice(cls.bodyOpen + 1, cls.bodyClose);
      const fields = [];
      // Fields may share a line (`final String a; final String b;`), so split on ; { } too.
      for (const m of body.matchAll(/(?:^|[\n;{}])\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:final\s+|late\s+)*([A-Z]\w*(?:<[^;=(){}]*>)?\??|int\??|double\??|bool\??|num\??|String\??)\s+(\w+)\s*(?=;)/g)) fields.push({ type: m[1], name: m[2] });
      if (fields.length > 0) userModels.push({ file: file.rel, class: cls.name, fields });
    }
  }

  // ---- scaffold / setup ----------------------------------------------------------------------
  const anyMask = (re) => files.some((f) => re.test(f.mask));
  const findFile = (re) => files.find((f) => re.test(f.mask))?.rel ?? null;
  const gitignore = existsSync(path.join(root, '.gitignore')) ? readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
  const syncFile = findFile(/\bclass\s+UserProfileSync\b/);
  const syncCalls = files.filter((f) => f.rel !== syncFile && /\bUserProfileSync\s*\.\s*(?:sync|syncAnonymous)\s*\(/.test(f.mask)).map((f) => f.rel);
  const clearCalls = files.filter((f) => f.rel !== syncFile && /\bUserProfileSync\s*\.\s*clear\s*\(/.test(f.mask)).map((f) => f.rel);
  const hasLogout = anyMask(/\b(?:logout|logOut|signOut|deleteAccount)\s*\(/);

  const setup = {
    dep_firebase_core: hasDep('firebase_core'),
    dep_firebase_analytics: hasDep('firebase_analytics'),
    dep_appmetrica: hasDep('appmetrica_plugin'),
    facade: findFile(/\bclass\s+Analytics\b[^{]*\{[\s\S]*?\bstatic\s+Future<void>\s+track\s*\(/),
    events_enum: findFile(/\benum\s+AnalyticsEvent\b/),
    firebase_observer: anyMask(/\bFirebaseAnalyticsObserver\b/) && anyMask(/\b(?:observers|navigatorObservers)\s*:/),
    appmetrica_observer: files.some((f) => /\b(?:Analytics|AppMetrica)NavigatorObserver\s*\(/.test(f.mask) && /\b(?:observers|navigatorObservers)\s*:/.test(f.mask)),
    firebase_init: anyMask(/\bFirebase\s*\.\s*initializeApp\s*\(/),
    appmetrica_activate: anyMask(/\bAppMetrica\s*\.\s*activate\s*\(/),
    zone_guard: anyMask(/\brunZonedGuarded\s*[<(]/),
    secrets_ignored: /(^|\n)\s*(?:\*\*\/)?(?:lib\/core\/secrets\/)?\.env\s*(\n|$)|(^|\n)\s*\*\.env\s*(\n|$)/.test(gitignore),
  };

  const profile = { sync_file: syncFile, sync_calls: syncCalls, clear_calls: clearCalls, logout_detected: hasLogout, covered: !!syncFile && syncCalls.length > 0 && (!hasLogout || clearCalls.length > 0) };

  const detected = {
    router: hasDep('go_router') || routes.some((r) => r.kind === 'go_route') ? 'go_router' : hasDep('auto_route') ? 'auto_route' : hasDep('get') ? 'getx' : 'navigator',
    state: hasDep('flutter_bloc') || hasDep('bloc') ? 'bloc' : hasDep('flutter_riverpod') || hasDep('hooks_riverpod') || hasDep('riverpod') ? 'riverpod' : hasDep('provider') ? 'provider' : hasDep('get') ? 'getx' : hasDep('mobx') ? 'mobx' : 'setState',
    di: hasDep('get_it') ? (hasDep('injectable') ? 'get_it+injectable' : 'get_it') : 'none',
    analytics: { firebase_analytics: setup.dep_firebase_analytics, appmetrica_plugin: setup.dep_appmetrica, facade: !!setup.facade },
    package: /^name:\s*(\S+)/m.exec(pubspec)?.[1] ?? null,
    dart_files: files.length,
  };

  const live = (list) => list.filter((x) => !x.ignored);
  const summary = {
    routes: { total: live(routes).length, named: live(routes).filter((r) => r.hasName).length },
    modals: { total: live(modals).length, with_route_settings: live(modals).filter((x) => x.hasRouteSettings).length },
    screens: { total: live(screens).length, covered: live(screens).filter((s) => s.covered).length },
    actions: { total: actions.length, instrumented: actions.filter((a) => a.instrumented).length, excluded: excluded.length },
    logic_handlers: { total: blocs.reduce((n, b) => n + b.handlers.length, 0), instrumented: blocs.reduce((n, b) => n + b.handlers.filter((h) => h.instrumented).length, 0) },
    user_models: userModels.length,
  };

  return { root: path.resolve(root), detected, summary, setup, profile, routes, modals, screens, actions, excluded, blocs, userModels };
}
