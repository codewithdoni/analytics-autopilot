import 'package:flutter/material.dart';

import '../core/analytics/analytics.dart';
import '../core/analytics/analytics_event.dart';
import '../core/analytics/user_profile_sync.dart';
import '../repository/session_repository.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  static const List<String> _plans = ['free', 'plus', 'pro'];

  final TextEditingController _nameController = TextEditingController();

  bool _notificationsEnabled = true;
  String _displayName = '';

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  void _onNotificationsChanged(bool value) {
    setState(() => _notificationsEnabled = value);
    Analytics.track(
      AnalyticsEvent.settingsNotificationsToggled,
      parameters: {'enabled': value},
    );
    UserProfileSync.syncAnonymous(
      notificationsEnabled: value,
      traits: {'notifications_enabled': value},
    );
  }

  // analytics:ignore per-keystroke text input — the submitted value is tracked
  void _onNameChanged(String value) {
    setState(() => _displayName = value);
  }

  void _onNameSubmitted(String value) {
    FocusScope.of(context).unfocus();
    final name = value.trim();
    setState(() => _displayName = name);
    // The name itself is personal data: only its length is reported.
    Analytics.track(
      AnalyticsEvent.settingsDisplayNameSubmitted,
      parameters: {'length': name.length},
    );
  }

  void _onPlanChanged(String? plan) {
    if (plan == null) return;
    final session = SessionScope.of(context);
    final previous = session.currentUser?.plan;
    if (previous == plan) return;

    session.setPlan(plan);
    Analytics.track(
      AnalyticsEvent.settingsPlanChanged,
      parameters: {'plan': plan, 'previous_plan': previous},
    );
    // The plan is also who the user IS, so it becomes a user property too.
    final user = session.currentUser;
    if (user != null) {
      UserProfileSync.sync(
        userId: user.id,
        traits: {'plan': user.plan, 'locale': user.locale},
      );
    }
  }

  Future<void> _confirmSignOut() async {
    final session = SessionScope.of(context);
    Analytics.track(AnalyticsEvent.settingsSignOutTapped);

    final shouldSignOut = await showDialog<bool>(
      context: context,
      routeSettings: const RouteSettings(name: 'sign_out_dialog'),
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Sign out?'),
          content: const Text('You will need to sign in again to continue.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Sign out'),
            ),
          ],
        );
      },
    );

    // One event with the outcome beats two events for the two buttons.
    Analytics.track(
      AnalyticsEvent.settingsSignOutCompleted,
      parameters: {'confirmed': shouldSignOut == true},
    );
    if (shouldSignOut != true) return;

    await session.signOut();
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Signed out')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final plan = session.currentUser?.plan ?? _plans.first;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          SwitchListTile(
            title: const Text('Notifications'),
            subtitle: const Text('Receive product updates'),
            value: _notificationsEnabled,
            onChanged: _onNotificationsChanged,
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              controller: _nameController,
              decoration: InputDecoration(
                labelText: 'Display name',
                border: const OutlineInputBorder(),
                helperText: _displayName.isEmpty ? null : 'Hi, $_displayName',
              ),
              textInputAction: TextInputAction.done,
              onChanged: _onNameChanged,
              onSubmitted: _onNameSubmitted,
            ),
          ),
          ListTile(
            title: const Text('Plan'),
            trailing: DropdownButton<String>(
              value: plan,
              onChanged: _onPlanChanged,
              items: [
                for (final option in _plans)
                  DropdownMenuItem<String>(
                    value: option,
                    child: Text(option),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: ElevatedButton(
              onPressed: _confirmSignOut,
              child: const Text('Sign out'),
            ),
          ),
        ],
      ),
    );
  }
}
