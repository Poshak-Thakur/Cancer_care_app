import 'package:flutter/material.dart';
import '../shared/alerts/alert_detail_screen.dart';
import '../../core/theme/app_colors.dart';
import '../patient/community/screens/community_screen.dart';
import '../patient/messages/screens/conversations_screen.dart';
import 'patients/screens/caregiver_patients_screen.dart';
import 'profile/screens/caregiver_profile_screen.dart';

/// Caregiver home: patients, messages (family, care team, NGO helpline),
/// community and profile.
class CaregiverShell extends StatefulWidget {
  const CaregiverShell({super.key});

  @override
  State<CaregiverShell> createState() => _CaregiverShellState();
}

class _CaregiverShellState extends State<CaregiverShell> {
  @override
  void initState() {
    super.initState();
    // A tapped critical-alert notification that arrived before the UI existed (cold start).
    WidgetsBinding.instance.addPostFrameCallback((_) => AlertNavigator.openPendingIfAny());
  }

  int _index = 0;
  int _patientsVersion = 0; // bumped after linking so the patient list reloads from the backend

  void _onLinked() => setState(() {
        _patientsVersion++;
        _index = 0;
      });

  @override
  Widget build(BuildContext context) {
    final screens = [
      CaregiverPatientsScreen(key: ValueKey('patients-$_patientsVersion')),
      const ConversationsScreen(),
      const CommunityScreen(),
      CaregiverProfileScreen(onLinked: _onLinked),
    ];
    return Scaffold(
      body: SafeArea(child: IndexedStack(index: _index, children: screens)),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
        type: BottomNavigationBarType.fixed,
        backgroundColor: AppColors.surface,
        selectedItemColor: AppColors.primary,
        unselectedItemColor: AppColors.textFaint,
        showSelectedLabels: false,
        showUnselectedLabels: false,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.groups_outlined), activeIcon: Icon(Icons.groups), label: 'Patients'),
          BottomNavigationBarItem(icon: Icon(Icons.chat_bubble_outline), activeIcon: Icon(Icons.chat_bubble), label: 'Messages'),
          BottomNavigationBarItem(icon: Icon(Icons.diversity_1_outlined), activeIcon: Icon(Icons.diversity_1), label: 'Community'),
          BottomNavigationBarItem(icon: Icon(Icons.person_outline), activeIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
