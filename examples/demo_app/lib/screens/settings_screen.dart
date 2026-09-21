import 'package:flutter/material.dart';

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
  }

  void _onNameChanged(String value) {
    setState(() => _displayName = value);
  }

  void _onNameSubmitted(String value) {
    FocusScope.of(context).unfocus();
    setState(() => _displayName = value.trim());
  }

  void _onPlanChanged(String? plan) {
    if (plan == null) return;
    SessionScope.of(context).setPlan(plan);
  }

  Future<void> _confirmSignOut() async {
    final session = SessionScope.of(context);

    final shouldSignOut = await showDialog<bool>(
      context: context,
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
