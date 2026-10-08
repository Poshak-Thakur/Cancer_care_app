import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import '../../../../core/authorization/access_guard.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/widgets/buttons.dart';
import '../models/care_event.dart';
import '../services/care_event_service.dart';
import '../widgets/care_event_labels.dart';

/// Add a task or appointment. Type or dictate a sentence ("Chemo session
/// tomorrow at 10 AM"): the server's AI turns it into a type, title, place
/// and time, which the person can correct before saving. Manual entry works
/// too. Pops with `true` once the event is saved.
class AddCareEventScreen extends StatefulWidget {
  final String patientId;
  const AddCareEventScreen({super.key, required this.patientId});

  @override
  State<AddCareEventScreen> createState() => _AddCareEventScreenState();
}

class _AddCareEventScreenState extends State<AddCareEventScreen> {
  final _service = CareEventService();
  final _speech = stt.SpeechToText();

  final _sentence = TextEditingController();
  final _title = TextEditingController();
  final _location = TextEditingController();
  final _note = TextEditingController();

  bool _formStep = false; // false: sentence step, true: confirm/edit step
  bool _parsing = false;
  bool _saving = false;
  bool _listening = false;
  String? _error;

  String _type = 'APPOINTMENT';
  DateTime _day = Ist.today(); // IST calendar day
  TimeOfDay _time = const TimeOfDay(hour: 9, minute: 0);

  @override
  void dispose() {
    _speech.stop();
    _sentence.dispose();
    _title.dispose();
    _location.dispose();
    _note.dispose();
    super.dispose();
  }

  void _toast(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  // ---------------------------------------------------------------- dictation

  Future<void> _toggleMic() async {
    if (_listening) {
      await _speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }
    final ok = await _speech.initialize(
      onStatus: (s) {
        if ((s == 'done' || s == 'notListening') && mounted) setState(() => _listening = false);
      },
      onError: (_) {
        if (mounted) setState(() => _listening = false);
      },
    );
    if (!ok) {
      _toast(S.t('speechUnavailable'));
      return;
    }
    setState(() => _listening = true);
    await _speech.listen(
      localeId: Lang.isHindi.value ? 'hi_IN' : 'en_IN',
      listenFor: const Duration(seconds: 40),
      pauseFor: const Duration(seconds: 4),
      onResult: (r) {
        if (!mounted) return;
        setState(() => _sentence.text = r.recognizedWords);
      },
    );
  }

  // ---------------------------------------------------------------- AI parse

  Future<void> _understand() async {
    final text = _sentence.text.trim();
    if (text.isEmpty || _parsing) return;
    if (_listening) await _speech.stop();
    FocusScope.of(context).unfocus();
    setState(() {
      _parsing = true;
      _error = null;
      _listening = false;
    });
    try {
      final p = await _service.parseCommand(text);
      if (!mounted) return;
      _fill(p);
      setState(() {
        _parsing = false;
        _formStep = true;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _parsing = false;
        _error = e.statusCode == 500 ? S.t('parseFailed') : e.message;
      });
    }
  }

  void _fill(ParsedCommand p) {
    _type = p.type;
    _title.text = p.title;
    _location.text = p.location ?? '';
    _note.text = p.note ?? '';
    final when = p.scheduleTime;
    if (when != null) {
      final wall = Ist.toWall(when);
      _day = DateTime(wall.year, wall.month, wall.day);
      _time = TimeOfDay(hour: wall.hour, minute: wall.minute);
    }
  }

  void _manual() {
    setState(() {
      _formStep = true;
      _error = null;
    });
  }

  // ---------------------------------------------------------------- form

  Future<void> _pickDay() async {
    final today = Ist.today();
    final picked = await showDatePicker(
      context: context,
      initialDate: _day.isBefore(today) ? today : _day,
      firstDate: today.subtract(const Duration(days: 30)),
      lastDate: today.add(const Duration(days: 365)),
      initialEntryMode: DatePickerEntryMode.calendarOnly,
    );
    if (picked != null) setState(() => _day = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(context: context, initialTime: _time);
    if (picked != null) setState(() => _time = picked);
  }

  Future<void> _save() async {
    if (_saving) return;
    final title = _title.text.trim();
    if (title.isEmpty) {
      setState(() => _error = S.t('titleRequired'));
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final moment = Ist.fromWall(DateTime(_day.year, _day.month, _day.day, _time.hour, _time.minute));
      await _service.create(
        patientId: widget.patientId,
        type: _type,
        scheduleTime: moment,
        title: title,
        location: _location.text,
        note: _note.text,
      );
      if (!mounted) return;
      _toast(S.t('eventAdded'));
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (AccessGuard.handle(context, e)) return;
      setState(() {
        _saving = false;
        _error = e.message;
      });
    }
  }

  // ---------------------------------------------------------------- build

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          appBar: AppBar(title: Text(S.t('addToCare'))),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
              children: _formStep ? _formView() : _sentenceView(),
            ),
          ),
        );
      },
    );
  }

  List<Widget> _sentenceView() {
    return [
      Text(S.t('scheduleHelp'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.45)),
      const SizedBox(height: 16),
      TextField(
        controller: _sentence,
        minLines: 3,
        maxLines: 5,
        textCapitalization: TextCapitalization.sentences,
        onChanged: (_) => setState(() => _error = null),
        decoration: InputDecoration(
          hintText: S.t('scheduleHint'),
          filled: true,
          fillColor: AppColors.surface,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      const SizedBox(height: 10),
      Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: _listening ? Colors.red : AppColors.primary,
                side: BorderSide(color: _listening ? Colors.red : AppColors.primary, width: 1.5),
                padding: const EdgeInsets.symmetric(vertical: 13),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              onPressed: _toggleMic,
              icon: Icon(_listening ? Icons.stop_circle_outlined : Icons.mic_none),
              label: Text(_listening ? S.t('listening') : S.t('speak')),
            ),
          ),
        ],
      ),
      const SizedBox(height: 16),
      if (_error != null) _errorRow(_error!),
      _parsing
          ? const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
          : Opacity(opacity: _sentence.text.trim().isEmpty ? 0.5 : 1, child: PrimaryButton(label: S.t('understand'), onPressed: _understand)),
      const SizedBox(height: 8),
      Center(child: TextButton(onPressed: _manual, child: Text(S.t('fillManually')))),
    ];
  }

  List<Widget> _formView() {
    final dateLabel = Ist.dateLabel(_day);
    return [
      if (_sentence.text.trim().isNotEmpty)
        Container(
          padding: const EdgeInsets.all(12),
          margin: const EdgeInsets.only(bottom: 16),
          decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(12)),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.auto_awesome, size: 18, color: AppColors.primaryDeep),
              const SizedBox(width: 8),
              Expanded(child: Text(S.t('checkDetails'), style: const TextStyle(fontSize: 13.5, color: AppColors.primaryDeep, height: 1.4))),
            ],
          ),
        ),
      _label(S.t('eventType')),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final t in careEventTypes)
            ChoiceChip(
              label: Text(careEventTypeLabel(t)),
              selected: _type == t,
              selectedColor: AppColors.primaryLight,
              onSelected: (_) => setState(() => _type = t),
            ),
        ],
      ),
      const SizedBox(height: 18),
      _label(S.t('eventTitle')),
      TextField(controller: _title, textCapitalization: TextCapitalization.sentences, onChanged: (_) => setState(() => _error = null), decoration: _dec(S.t('eventTitleHint'))),
      const SizedBox(height: 18),
      Row(
        children: [
          Expanded(child: _pickerBox(S.t('date'), dateLabel, Icons.calendar_today_outlined, _pickDay)),
          const SizedBox(width: 12),
          Expanded(child: _pickerBox(S.t('time'), _time.format(context), Icons.access_time, _pickTime)),
        ],
      ),
      const SizedBox(height: 6),
      Text(S.t('istNote'), style: const TextStyle(fontSize: 12, color: AppColors.textFaint)),
      const SizedBox(height: 14),
      _label(S.t('location')),
      TextField(controller: _location, textCapitalization: TextCapitalization.words, decoration: _dec(S.t('locationHint'))),
      const SizedBox(height: 18),
      _label(S.t('note')),
      TextField(controller: _note, minLines: 2, maxLines: 4, textCapitalization: TextCapitalization.sentences, decoration: _dec(null)),
      const SizedBox(height: 22),
      if (_error != null) _errorRow(_error!),
      _saving
          ? const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
          : PrimaryButton(label: S.t('saveEvent'), onPressed: _save),
      const SizedBox(height: 8),
      Center(child: TextButton(onPressed: () => setState(() => _formStep = false), child: Text(S.t('backToSentence')))),
    ];
  }

  Widget _label(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(t, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textFaint)),
      );

  Widget _errorRow(String m) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.info_outline, size: 16, color: AppColors.warning),
            const SizedBox(width: 6),
            Expanded(child: Text(m, style: const TextStyle(fontSize: 13, color: AppColors.warning))),
          ],
        ),
      );

  InputDecoration _dec(String? hint) => InputDecoration(
        hintText: hint,
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      );

  Widget _pickerBox(String label, String value, IconData icon, VoidCallback onTap) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label(label),
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
            decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.ink.withOpacity(0.2))),
            child: Row(
              children: [
                Expanded(child: Text(value, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600))),
                Icon(icon, size: 18, color: AppColors.primary),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
