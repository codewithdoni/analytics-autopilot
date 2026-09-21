# What the scanner sees, and what it cannot

`scan.mjs` reads Dart with regexes over a comment- and string-masked view of each file. It
is deliberately simple and has no Dart analyzer dependency, so it runs anywhere in a second.
Treat its output as a worklist, not as truth.

## Reliably detected

* `GoRoute(path:, name:, builder:/pageBuilder:)`, including nested and shell routes.
* `MaterialPageRoute` / `CupertinoPageRoute` / `PageRouteBuilder` and whether they carry
  `settings: RouteSettings(name: ...)`.
* `showModalBottomSheet`, `showDialog`, `showCupertinoModalPopup`, `showGeneralDialog` and
  the `modal_bottom_sheet` variants, and whether they carry `routeSettings:`.
* `MaterialApp(routes: {...})` tables and `@RoutePage()` (auto_route) classes.
* Widget classes (`StatelessWidget`, `StatefulWidget`, `State<T>`, Riverpod `Consumer*`,
  `HookWidget`, GetX views) and whether they build a `Scaffold`.
* Handlers: `onPressed`, `onTap`, `onLongPress`, `onDoubleTap`, `onChanged`, `onSubmitted`,
  `onFieldSubmitted`, `onSelected`, `onDismissed`, `onRefresh`, `onToggle`, `onConfirm`,
  `onDestinationSelected`, `onSelectionChanged`, `onPageChanged`, `onReorder`, `onDeleted`,
  stepper callbacks, `onRatingUpdate`, `onAccept`.
* One hop of delegation: `onPressed: _save` or `onPressed: () => _save()` finds `_save` in
  the same class or file; `context.read<XBloc>().add(SaveEvent())` finds the matching
  `on<SaveEvent>` handler; `controller.save()` finds `save()` on a Cubit/Notifier/Controller.
* Route and screen names stored as `static const String` constants are resolved to their value.

## Not detected — check these yourself

* Routes or names built at runtime (string interpolation, a map built in a loop, codegen
  output that is not on disk).
* Handlers two or more hops away (`onPressed: widget.onSave` where the parent passes another
  indirection), and callbacks stored in variables or maps. These are reported as `excluded`
  with the reason `pass-through`, and you must instrument the real call site.
* Custom navigation wrappers (`AppNavigator.push(...)`, `Get.to(...)`) — give them
  `RouteSettings` yourself.
* Gesture detectors built from `Listener`, `RawGestureDetector`, or custom `GestureRecognizer`s.
* Anything inside generated files (`*.g.dart`, `*.freezed.dart`, `*.gr.dart`) — skipped on purpose.

## Excluded by policy, not by accident

`coverage.mjs` does not require these, and lists them under `excluded`:

* `onChanged` on a text field — per-keystroke events are noise and a PII risk. Track
  `onSubmitted`, or the form submit.
* Pass-through callbacks (`onTap: widget.onTap`) — the owner of the behaviour gets the event.
* Anything marked `// analytics:ignore <reason>`.
