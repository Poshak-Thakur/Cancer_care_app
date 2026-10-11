import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/authorization/access_guard.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../auth/services/auth_state.dart';
import '../models/check_in_form.dart';
import '../services/check_in_service.dart';
import '../services/clinical_observation_mapper.dart';

/// Today's symptom check-in.
///
/// The questions come from the form the NGO has PUBLISHED
/// (GET /api/symptoms/check-in/form) and answers are submitted against that
/// form version. Only when the backend says no form is published yet
/// (404 NO_PUBLISHED_FORM) does the screen fall back to the built-in
/// [checkInQuestions]. Other failures show an error with a retry.
///
/// A second check-in on the same (IST) day is saved as an UPDATE. Answering
/// "severe" on an established clinical question makes the backend raise an
/// alert for the care team, and the screen says so.
class CheckInScreen extends StatefulWidget {
  /// Defaults to the signed-in patient; caregivers pass the patient they view.
  final String? patientId;
  const CheckInScreen({super.key, this.patientId});

  @override
  State<CheckInScreen> createState() => _CheckInScreenState();
}

enum _Mode { loading, form, builtIn, error }

class _CheckInScreenState extends State<CheckInScreen> {
  final _service = CheckInService();
  _Mode _mode = _Mode.loading;
  CheckInForm? _form;

  // Dynamic form state, keyed by field id.
  final Map<String, TextEditingController> _text = {}; // TEXT, LONG_TEXT, NUMBER
  final Map<String, String?> _single = {}; // SINGLE_CHOICE (option_value)
  final Map<String, Set<String>> _multi = {}; // MULTI_CHOICE (option_values)
  final Map<String, bool?> _bool = {}; // BOOLEAN
  final Map<String, int?> _scale = {}; // SCALE
  final Map<String, String> _fieldErrors = {};
  final _note = TextEditingController();
  String? _eventId;
  String? _eventFingerprint;

  /// One client_event_id per distinct submission. Retrying the SAME answers
  /// (after a timeout or lost response) reuses the id, so the backend
  /// recognises the retry instead of recording a second check-in. If the
  /// person changes an answer, the submission is a different one and gets a
  /// new id; otherwise the backend would reply "already recorded" and silently
  /// drop the change. `source` is left out on purpose: it can flip from
  /// ROUTINE to UPDATE between two tries of the same submission.
  String _eventIdFor(String fingerprint) {
    if (_eventId == null || _eventFingerprint != fingerprint) {
      _eventId = CheckInService.newClientEventId();
      _eventFingerprint = fingerprint;
    }
    return _eventId!;
  }
  final Map<String, int?> _selected = {for (final q in checkInQuestions) if (q.kind == CheckInKind.levels) q.key: null};
  final Map<String, TextEditingController> _numbers = {for (final q in checkInQuestions) if (q.kind == CheckInKind.number) q.key: TextEditingController()};

  bool _alreadyDone = false;
  bool _saving = false;
  bool _saved = false;
  bool _severe = false;
  String? _error;

  String? get _pid => widget.patientId ?? AuthState.patientId;

  @override
  void initState() {
    super.initState();
    _checkStatus();
    _loadForm();
  }

  @override
  void dispose() {
    for (final c in _numbers.values) {
      c.dispose();
    }
    for (final c in _text.values) {
      c.dispose();
    }
    _note.dispose();
    super.dispose();
  }

  /// Fetches the published form. 404 NO_PUBLISHED_FORM -> built-in questions;
  /// any other failure -> error + retry (never silently outdated data).
  Future<void> _loadForm() async {
    if (_mode != _Mode.loading) {
      setState(() {
        _mode = _Mode.loading;
        _error = null;
      });
    }
    try {
      final form = await _service.fetchPublishedForm();
      if (!mounted) return;
      if (form == null) {
        setState(() => _mode = _Mode.builtIn);
        return;
      }
      _initFormState(form);
      setState(() {
        _form = form;
        _mode = _Mode.form;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (AccessGuard.handle(context, e)) return;
      setState(() => _mode = _Mode.error);
    } catch (_) {
      if (!mounted) return;
      setState(() => _mode = _Mode.error); // unexpected response shape
    }
  }

  void _initFormState(CheckInForm form) {
    for (final c in _text.values) {
      c.dispose();
    }
    _text.clear();
    _single.clear();
    _multi.clear();
    _bool.clear();
    _scale.clear();
    _fieldErrors.clear();
    for (final f in form.fields) {
      switch (f.type) {
        case CheckInFieldType.text:
        case CheckInFieldType.longText:
        case CheckInFieldType.number:
          _text[f.id] = TextEditingController();
          break;
        case CheckInFieldType.singleChoice:
          _single[f.id] = null;
          break;
        case CheckInFieldType.multiChoice:
          _multi[f.id] = <String>{};
          break;
        case CheckInFieldType.boolean:
          _bool[f.id] = null;
          break;
        case CheckInFieldType.scale:
          _scale[f.id] = null;
          break;
        case CheckInFieldType.unknown:
          break;
      }
    }
  }

  // ---------------------------------------------------------------- dynamic form: validation + submit

  /// Reads one field's answer. Returns (value, error). A null value with no
  /// error means "unanswered".
  (dynamic, String?) _readField(CheckInField f) {
    switch (f.type) {
      case CheckInFieldType.text:
      case CheckInFieldType.longText:
        final t = _text[f.id]!.text.trim();
        if (t.isEmpty) return (null, f.isRequired ? S.t('fieldRequired') : null);
        return (t, null);
      case CheckInFieldType.number:
        final raw = _text[f.id]!.text.trim().replaceAll(',', '.');
        if (raw.isEmpty) return (null, f.isRequired ? S.t('fieldRequired') : null);
        final n = num.tryParse(raw);
        if (n == null || !n.isFinite) return (null, S.t('fieldNumberInvalid'));
        if (f.integerOnly && n != n.truncate()) return (null, S.t('fieldWholeNumber'));
        if (f.minNumber != null && n < f.minNumber!) return (null, S.mustBeAtLeast(f.minNumber!));
        if (f.maxNumber != null && n > f.maxNumber!) return (null, S.mustBeAtMost(f.maxNumber!));
        return (f.integerOnly ? n.toInt() : n, null);
      case CheckInFieldType.boolean:
        final b = _bool[f.id];
        if (b == null) return (null, f.isRequired ? S.t('fieldRequired') : null);
        return (b, null);
      case CheckInFieldType.singleChoice:
        final v = _single[f.id];
        if (v == null) return (null, f.isRequired ? S.t('fieldRequired') : null);
        return (v, null);
      case CheckInFieldType.multiChoice:
        final picked = f.options.where((o) => _multi[f.id]!.contains(o.optionValue)).map((o) => o.optionValue).toList();
        if (picked.isEmpty) {
          if (f.isRequired) return (null, S.t('fieldRequired'));
          // An optional multi-select with a minimum is only enforced once something is picked.
          return (null, null);
        }
        if (f.minSelections != null && picked.length < f.minSelections!) return (null, S.chooseAtLeast(f.minSelections!));
        if (f.maxSelections != null && picked.length > f.maxSelections!) return (null, S.chooseAtMost(f.maxSelections!));
        return (picked, null);
      case CheckInFieldType.scale:
        final v = _scale[f.id];
        if (v == null) return (null, f.isRequired ? S.t('fieldRequired') : null);
        return (v, null);
      case CheckInFieldType.unknown:
        return (null, null);
    }
  }

  Future<void> _saveForm() async {
    final form = _form;
    if (form == null || _saving || _saved) return;
    if (form.hasUnsupportedRequired) {
      setState(() => _error = S.t('formNeedsUpdate'));
      return;
    }

    final answers = <CheckInAnswerInput>[];
    final values = <String, dynamic>{};
    final errors = <String, String>{};
    for (final f in form.fields) {
      if (!f.isSupported) continue;
      final (value, err) = _readField(f);
      if (err != null) {
        errors[f.id] = err;
      } else if (value != null) {
        answers.add(CheckInAnswerInput(f.id, value));
        values[f.id] = value;
      }
    }
    if (errors.isNotEmpty) {
      setState(() {
        _fieldErrors
          ..clear()
          ..addAll(errors);
        _error = null;
      });
      return;
    }
    if (answers.isEmpty) {
      setState(() {
        _fieldErrors.clear();
        _error = S.t('pickOne');
      });
      return;
    }
    final pid = _pid;
    if (pid == null) {
      setState(() => _error = S.t('couldNotSave'));
      return;
    }

    // Only established clinical fields become observations (alert rule input).
    final observations = ClinicalObservationMapper.build(form, values);

    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
      _fieldErrors.clear();
    });
    try {
      await _service.submitForm(
        patientId: pid,
        formVersionId: form.version.id,
        answers: answers,
        observations: observations,
        source: _alreadyDone ? 'UPDATE' : 'ROUTINE',
        clientEventId: _eventIdFor(jsonEncode([pid, form.version.id, answers.map((a) => a.toJson()).toList(), observations])), // same id for every retry of the same answers
      );
      if (!mounted) return;
      setState(() {
        _saving = false;
        _saved = true;
        _severe = CheckInService.hasSevere(observations);
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (AccessGuard.handle(context, e)) return;
      setState(() {
        _saving = false;
        if (e.statusCode == 403) {
          _error = S.t('limitedAccessSub');
        } else if (e.code == 'VALIDATION_FAILED') {
          _error = S.t('checkinInvalid');
        } else if (e.code == 'UNKNOWN_FORM_VERSION') {
          _error = S.t('formLoadFailed'); // the NGO changed the form: reload it
        } else {
          _error = S.t('couldNotSave');
        }
      });
      if (e.code == 'UNKNOWN_FORM_VERSION') _loadForm();
    }
  }

  Future<void> _checkStatus() async {
    final pid = _pid;
    if (pid == null) return;
    try {
      final done = await _service.completedToday(pid);
      if (mounted) setState(() => _alreadyDone = done);
    } on ApiException {
      // not critical: the first save of the day is simply sent as ROUTINE
    }
  }

  Future<void> _save() async {
    if (_saving || _saved) return;
    final numbers = <String, double?>{
      for (final e in _numbers.entries) e.key: double.tryParse(e.value.text.trim().replaceAll(',', '.')),
    };
    if (_numbers.entries.any((e) => e.value.text.trim().isNotEmpty && numbers[e.key] == null)) {
      setState(() => _error = S.t('enterNumber'));
      return;
    }
    final observations = CheckInService.buildObservations(levels: _selected, numbers: numbers, note: _note.text);
    if (observations.isEmpty) {
      setState(() => _error = S.t('pickOne'));
      return;
    }
    final pid = _pid;
    if (pid == null) {
      setState(() => _error = S.t('couldNotSave'));
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _service.submit(
        patientId: pid,
        observations: observations,
        source: _alreadyDone ? 'UPDATE' : 'ROUTINE',
        clientEventId: _eventIdFor(jsonEncode([pid, observations])),
      );
      if (!mounted) return;
      setState(() {
        _saving = false;
        _saved = true;
        _severe = CheckInService.hasSevere(observations);
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (AccessGuard.handle(context, e)) return;
      setState(() {
        _saving = false;
        _error = e.statusCode == 403 ? S.t('limitedAccessSub') : S.t('couldNotSave');
      });
    }
  }

  IconData _icon(IconCodes c) {
    switch (c) {
      case IconCodes.pain:
        return Icons.favorite_border;
      case IconCodes.fatigue:
        return Icons.battery_2_bar;
      case IconCodes.appetite:
        return Icons.restaurant;
      case IconCodes.mood:
        return Icons.sentiment_satisfied_alt;
      case IconCodes.nausea:
        return Icons.sick_outlined;
      case IconCodes.breathing:
        return Icons.air;
      case IconCodes.dizzy:
        return Icons.rotate_right;
      case IconCodes.water:
        return Icons.water_drop_outlined;
      case IconCodes.sleep:
        return Icons.bedtime_outlined;
    }
  }

  Widget _numberBlock(CheckInQuestion q) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_icon(q.icon), color: AppColors.primary, size: 22),
              const SizedBox(width: 10),
              Text(S.t(q.key), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5)),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _numbers[q.key],
            enabled: !_saved,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _error = null),
            decoration: InputDecoration(
              suffixText: S.t(q.unitLabelKey ?? ''),
              filled: true,
              fillColor: AppColors.surface,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _symptomBlock(CheckInQuestion q) {
    if (q.kind == CheckInKind.number) return _numberBlock(q);
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_icon(q.icon), color: AppColors.primary, size: 22),
              const SizedBox(width: 10),
              Text(S.t(q.key), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5)),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: List.generate(4, (i) {
              final active = _selected[q.key] == i;
              return Expanded(
                child: Padding(
                  padding: EdgeInsets.only(right: i == 3 ? 0 : 8),
                  child: InkWell(
                    onTap: _saved
                        ? null
                        : () => setState(() {
                              _selected[q.key] = active ? null : i;
                              _error = null;
                            }),
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                      decoration: BoxDecoration(
                        color: active ? AppColors.primaryLight : AppColors.surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: active ? AppColors.primary : AppColors.ink.withOpacity(0.08), width: 1.5),
                      ),
                      child: Column(
                        children: [
                          Container(width: 26, height: 26, decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.primaryLight)),
                          const SizedBox(height: 6),
                          Text(
                            S.t(q.levelKeys[i]),
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: active ? FontWeight.bold : FontWeight.w500,
                              color: active ? AppColors.primaryDeep : AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------- dynamic form: widgets

  Widget _fieldBlock(CheckInField f) {
    final err = _fieldErrors[f.id];
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text.rich(
            TextSpan(
              text: f.label,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5, color: AppColors.ink),
              children: [
                if (f.isRequired) const TextSpan(text: ' *', style: TextStyle(color: AppColors.warning)),
              ],
            ),
          ),
          if (f.helpText != null) ...[
            const SizedBox(height: 3),
            Text(f.helpText!, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.35)),
          ],
          const SizedBox(height: 10),
          _fieldInput(f),
          if (err != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(err, style: const TextStyle(fontSize: 12.5, color: AppColors.warning)),
            ),
        ],
      ),
    );
  }

  void _touch(CheckInField f, VoidCallback change) {
    setState(() {
      change();
      _fieldErrors.remove(f.id);
      _error = null;
    });
  }

  Widget _fieldInput(CheckInField f) {
    switch (f.type) {
      case CheckInFieldType.text:
        return _textInput(f, lines: 1, action: TextInputAction.next);
      case CheckInFieldType.longText:
        return _textInput(f, lines: 4, action: TextInputAction.newline);
      case CheckInFieldType.number:
        return _numberInput(f);
      case CheckInFieldType.boolean:
        return _booleanInput(f);
      case CheckInFieldType.singleChoice:
        return _singleChoiceInput(f);
      case CheckInFieldType.multiChoice:
        return _multiChoiceInput(f);
      case CheckInFieldType.scale:
        return _scaleInput(f);
      case CheckInFieldType.unknown:
        return const SizedBox.shrink();
    }
  }

  InputDecoration _inputDecoration({String? suffix}) => InputDecoration(
        suffixText: suffix,
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      );

  Widget _textInput(CheckInField f, {required int lines, required TextInputAction action}) {
    return TextField(
      controller: _text[f.id],
      enabled: !_saved,
      minLines: lines,
      maxLines: lines == 1 ? 1 : lines + 2,
      textInputAction: action,
      textCapitalization: TextCapitalization.sentences,
      inputFormatters: f.maxLength == null ? null : [LengthLimitingTextInputFormatter(f.maxLength)],
      onChanged: (_) => _touch(f, () {}),
      decoration: _inputDecoration(),
    );
  }

  Widget _numberInput(CheckInField f) {
    final signed = f.minNumber == null || f.minNumber! < 0;
    return TextField(
      controller: _text[f.id],
      enabled: !_saved,
      keyboardType: TextInputType.numberWithOptions(decimal: !f.integerOnly, signed: signed),
      onChanged: (_) => _touch(f, () {}),
      decoration: _inputDecoration(suffix: f.unit),
    );
  }

  Widget _booleanInput(CheckInField f) {
    final current = _bool[f.id];
    Widget chip(String label, bool value) => ChoiceChip(
          label: Text(label),
          selected: current == value,
          selectedColor: AppColors.primaryLight,
          onSelected: _saved ? null : (_) => _touch(f, () => _bool[f.id] = current == value ? null : value),
        );
    return Wrap(spacing: 10, children: [chip(S.t('yesLabel'), true), chip(S.t('noLabel'), false)]);
  }

  Widget _singleChoiceInput(CheckInField f) {
    final selected = _single[f.id];
    return Column(
      children: [
        for (final o in f.options)
          InkWell(
            onTap: _saved ? null : () => _touch(f, () => _single[f.id] = selected == o.optionValue ? null : o.optionValue),
            borderRadius: BorderRadius.circular(10),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 2),
              child: Row(
                children: [
                  Icon(
                    selected == o.optionValue ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                    color: selected == o.optionValue ? AppColors.primary : AppColors.textFaint,
                    size: 22,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      o.label,
                      style: TextStyle(fontSize: 14.5, fontWeight: selected == o.optionValue ? FontWeight.w600 : FontWeight.w500),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _multiChoiceInput(CheckInField f) {
    final picked = _multi[f.id]!;
    return Column(
      children: [
        for (final o in f.options)
          CheckboxListTile(
            value: picked.contains(o.optionValue),
            onChanged: _saved
                ? null
                : (v) => _touch(f, () {
                      if (v == true) {
                        picked.add(o.optionValue);
                      } else {
                        picked.remove(o.optionValue);
                      }
                    }),
            title: Text(o.label, style: const TextStyle(fontSize: 14.5)),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            dense: true,
            activeColor: AppColors.primary,
          ),
      ],
    );
  }

  Widget _scaleInput(CheckInField f) {
    final min = f.scaleMin;
    final max = f.scaleMax;
    final current = _scale[f.id];
    if (max - min <= 10) {
      return Wrap(
        spacing: 8,
        runSpacing: 4,
        children: [
          for (var i = min; i <= max; i++)
            ChoiceChip(
              label: Text('$i'),
              selected: current == i,
              selectedColor: AppColors.primaryLight,
              onSelected: _saved ? null : (_) => _touch(f, () => _scale[f.id] = current == i ? null : i),
            ),
        ],
      );
    }
    return Column(
      children: [
        Slider(
          value: (current ?? min).toDouble(),
          min: min.toDouble(),
          max: max.toDouble(),
          divisions: max - min,
          label: '${current ?? min}',
          activeColor: current == null ? AppColors.textFaint : AppColors.primary,
          onChanged: _saved ? null : (v) => _touch(f, () => _scale[f.id] = v.round()),
        ),
        Row(
          children: [
            Text('$min', style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint)),
            const Spacer(),
            Text(current == null ? S.t('notAnsweredLabel') : '$current', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
            if (current != null && !_saved)
              TextButton(onPressed: () => _touch(f, () => _scale[f.id] = null), child: Text(S.t('clearAnswer'))),
            const Spacer(),
            Text('$max', style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint)),
          ],
        ),
      ],
    );
  }

  // ---------------------------------------------------------------- shared pieces

  Widget _header() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(S.t('checkinSub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
          if (_alreadyDone && !_saved)
            Container(
              margin: const EdgeInsets.only(top: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(12)),
              child: Text(S.t('checkinAlreadyDone'), style: const TextStyle(fontSize: 13.5, color: AppColors.primaryDeep, height: 1.4)),
            ),
          const SizedBox(height: 20),
        ],
      );

  List<Widget> _footer(VoidCallback onSave) => [
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.info_outline, size: 16, color: AppColors.warning),
                const SizedBox(width: 6),
                Expanded(child: Text(_error!, style: const TextStyle(fontSize: 13.5, color: AppColors.warning))),
              ],
            ),
          ),
        if (_saved) ...[
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: _severe ? AppColors.roseLight : AppColors.primaryLight, borderRadius: BorderRadius.circular(14)),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 5),
                  child: Container(width: 8, height: 8, decoration: BoxDecoration(shape: BoxShape.circle, color: _severe ? AppColors.warning : AppColors.positive)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _severe ? S.t('severeNotice') : S.t('syncedMsg'),
                    style: TextStyle(fontSize: 14, height: 1.4, color: _severe ? AppColors.roseText : AppColors.primaryDeep, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          SecondaryButton(label: S.t('doneBtn'), onPressed: () => Navigator.of(context).pop(true)),
        ] else if (_saving)
          const SizedBox(height: 52, child: Center(child: SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary))))
        else
          PrimaryButton(label: S.t('saveCheckin'), onPressed: onSave),
      ];

  List<Widget> _formBody() {
    final form = _form!;
    return [
      _header(),
      if (form.hasUnsupportedRequired)
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: Text(S.t('formNeedsUpdate'), style: const TextStyle(fontSize: 13.5, color: AppColors.warning, height: 1.4)),
        ),
      for (final f in form.fields.where((f) => f.isSupported)) _fieldBlock(f),
      const SizedBox(height: 8),
      ..._footer(_saveForm),
    ];
  }

  List<Widget> _builtInBody() {
    final core = checkInQuestions.where((q) => !q.extra);
    final extra = checkInQuestions.where((q) => q.extra);
    return [
      _header(),
      for (final q in core) _symptomBlock(q),
      Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: EdgeInsets.zero,
          childrenPadding: EdgeInsets.zero,
          title: Text(S.t('moreSymptoms'), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
          children: [for (final q in extra) _symptomBlock(q)],
        ),
      ),
      const SizedBox(height: 8),
      TextField(
        controller: _note,
        enabled: !_saved,
        minLines: 2,
        maxLines: 4,
        textCapitalization: TextCapitalization.sentences,
        decoration: InputDecoration(
          hintText: S.t('checkinNoteHint'),
          filled: true,
          fillColor: AppColors.surface,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      const SizedBox(height: 20),
      ..._footer(_save),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final List<Widget> body;
        switch (_mode) {
          case _Mode.loading:
            body = const [LoadingView()];
            break;
          case _Mode.error:
            body = [ErrorView(message: S.t('formLoadFailed'), onRetry: _loadForm)];
            break;
          case _Mode.form:
            body = _formBody();
            break;
          case _Mode.builtIn:
            body = _builtInBody(); // temporary fallback: NGO has not published a form yet
            break;
        }
        return Scaffold(
          backgroundColor: AppColors.bg,
          appBar: AppBar(title: Text(S.t('todaysCheckin'))),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              children: body,
            ),
          ),
        );
      },
    );
  }
}
