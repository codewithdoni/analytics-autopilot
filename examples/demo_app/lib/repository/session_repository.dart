import 'package:flutter/widgets.dart';

import '../models/app_user.dart';

/// In-memory session store.
///
/// No backend and no persistence — just enough state for the screens to react
/// to sign-in, sign-out and plan changes.
class SessionRepository extends ChangeNotifier {
  AppUser? currentUser;

  bool get isSignedIn => currentUser != null;

  Future<void> signIn(String email) async {
    await Future<void>.delayed(const Duration(milliseconds: 150));
    currentUser = AppUser(
      id: email.hashCode.toRadixString(16),
      plan: 'free',
      locale: 'en',
      notificationsEnabled: true,
    );
    notifyListeners();
  }

  Future<void> signOut() async {
    await Future<void>.delayed(const Duration(milliseconds: 150));
    currentUser = null;
    notifyListeners();
  }

  void setPlan(String plan) {
    final user = currentUser;
    if (user == null) return;
    currentUser = user.copyWith(plan: plan);
    notifyListeners();
  }
}

/// Hands the [SessionRepository] down the tree without a state-management
/// package: dependents rebuild whenever the repository notifies.
class SessionScope extends InheritedNotifier<SessionRepository> {
  const SessionScope({
    required SessionRepository super.notifier,
    required super.child,
    super.key,
  });

  static SessionRepository of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<SessionScope>();
    assert(scope != null, 'No SessionScope found above this widget.');
    return scope!.notifier!;
  }
}
