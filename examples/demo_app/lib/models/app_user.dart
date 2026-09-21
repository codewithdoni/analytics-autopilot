/// An immutable snapshot of the signed-in user.
///
/// Plain data class on purpose — no codegen and no serialization.
class AppUser {
  const AppUser({
    required this.id,
    required this.plan,
    required this.locale,
    required this.notificationsEnabled,
    this.birthDate,
    this.gender,
  });

  final String id;
  final String plan;
  final String locale;
  final bool notificationsEnabled;
  final DateTime? birthDate;
  final String? gender;

  AppUser copyWith({
    String? id,
    String? plan,
    String? locale,
    bool? notificationsEnabled,
    DateTime? birthDate,
    String? gender,
  }) {
    return AppUser(
      id: id ?? this.id,
      plan: plan ?? this.plan,
      locale: locale ?? this.locale,
      notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
      birthDate: birthDate ?? this.birthDate,
      gender: gender ?? this.gender,
    );
  }

  @override
  String toString() => 'AppUser(id: $id, plan: $plan, locale: $locale)';
}
