import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl,
  Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { adminApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import { Feather } from '@expo/vector-icons';
import AdminScreenHeader from '../../components/AdminScreenHeader';
import type { UserGroup } from '../../types';

const DEFAULT_RAW_SIGNAL = 'NIFTY\n23800PE\nPRICE: 3\nSTOPLOSS: 0\nTARGETS: 15\nQTY: 1300';
const DEFAULT_FORM = {
  title: '',
  exchange_segment: 'NSE_FNO',
  security_id: '',
  transaction_type: 'BUY' as 'BUY' | 'SELL',
  product_type: 'INTRADAY',
  order_type: 'LIMIT',
  quantity: '',
  price: '',
  target_price: '',
  stop_loss_price: '',
  trailing_jump: '0',
};

export default function SignalCreateScreen() {
  const [entryMode, setEntryMode] = useState<'quick' | 'paste'>('quick');
  const [rawSignal, setRawSignal] = useState(DEFAULT_RAW_SIGNAL);
  const [lotSize, setLotSize] = useState<number | null>(null);
  const [hasParsed, setHasParsed] = useState(false);
  const [scripInfo, setScripInfo] = useState<{ found: boolean; tradingSymbol?: string; expiryDate?: string } | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Quick Select: one search box resolves symbol+expiry+CE/PE at once, then a
  // second inline search narrows down the strike — driven by the scrip sheet.
  const [contractQuery, setContractQuery] = useState('');
  const [contractResults, setContractResults] = useState<{ symbol: string; expiry_date: string; option_type: string }[]>([]);
  const [contractSearching, setContractSearching] = useState(false);
  const contractDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [quickSymbol, setQuickSymbol] = useState<string | null>(null);
  const [quickExpiry, setQuickExpiry] = useState<string | null>(null);
  const [quickOptionType, setQuickOptionType] = useState<'CE' | 'PE' | null>(null);
  const [quickStrikes, setQuickStrikes] = useState<{ strike: number; option_types: string[] }[]>([]);
  const [quickStrike, setQuickStrike] = useState<number | null>(null);
  const [quickLoadingStrikes, setQuickLoadingStrikes] = useState(false);
  const [strikeSearchText, setStrikeSearchText] = useState('');

  // Audience picker
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [audiencePickerVisible, setAudiencePickerVisible] = useState(false);
  const [draftGroupIds, setDraftGroupIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    adminApi.getGroups().then(setGroups).catch(() => {});
  }, []);

  const handleContractQueryChange = (q: string) => {
    setContractQuery(q);
    if (contractDebounce.current) clearTimeout(contractDebounce.current);
    const trimmed = q.trim();
    if (!trimmed) {
      setContractResults([]);
      setContractSearching(false);
      return;
    }
    setContractSearching(true);
    contractDebounce.current = setTimeout(async () => {
      try {
        const results = await adminApi.scripContracts(trimmed);
        setContractResults(results);
      } catch {
        setContractResults([]);
      } finally {
        setContractSearching(false);
      }
    }, 300);
  };

  const selectContract = (c: { symbol: string; expiry_date: string; option_type: string }) => {
    setQuickSymbol(c.symbol);
    setQuickExpiry(c.expiry_date);
    setQuickOptionType(c.option_type as 'CE' | 'PE');
    setContractQuery('');
    setContractResults([]);
    setQuickStrike(null);
    setStrikeSearchText('');
    setScripInfo(null);
    setForm((prev) => ({ ...prev, security_id: '' }));
    setQuickLoadingStrikes(true);
    adminApi.scripStrikes(c.symbol, c.expiry_date)
      .then(setQuickStrikes)
      .catch(() => setQuickStrikes([]))
      .finally(() => setQuickLoadingStrikes(false));
  };

  const resetContract = () => {
    setQuickSymbol(null);
    setQuickExpiry(null);
    setQuickOptionType(null);
    setQuickStrikes([]);
    setQuickStrike(null);
    setStrikeSearchText('');
    setContractQuery('');
    setContractResults([]);
    setScripInfo(null);
    setForm((prev) => ({ ...prev, security_id: '' }));
  };

  const selectQuickStrike = async (strike: number) => {
    if (!quickSymbol || !quickExpiry || !quickOptionType) return;
    setQuickStrike(strike);
    setLookingUp(true);
    setScripInfo(null);
    const exchange = quickSymbol.includes('SENSEX') || quickSymbol.includes('BANKEX') ? 'BSE' : 'NSE';
    try {
      const results = await adminApi.scripSearch({
        symbol: quickSymbol,
        strike,
        option_type: quickOptionType,
        expiry: quickExpiry,
        exchange,
      });
      if (results.length > 0) {
        const match = results[0];
        setLotSize(match.lot_size);
        setForm((prev) => ({
          ...prev,
          title: `${quickSymbol} ${strike}${quickOptionType} ${match.expiry_date}`,
          security_id: match.security_id,
          exchange_segment: match.exchange_segment,
          quantity: prev.quantity || String(match.lot_size),
        }));
        setScripInfo({ found: true, tradingSymbol: match.trading_symbol, expiryDate: match.expiry_date });
      } else {
        setScripInfo({ found: false });
      }
    } catch {
      setScripInfo({ found: false });
    } finally {
      setLookingUp(false);
    }
  };

  const filteredStrikes = quickStrikes
    .filter((s) => !quickOptionType || s.option_types.includes(quickOptionType))
    .filter((s) => !strikeSearchText.trim() || String(s.strike).includes(strikeSearchText.trim()));

  // Pull-to-refresh resets the signal creation draft back to default state.
  const handleRefresh = () => {
    if (loading || lookingUp) return;
    setRefreshing(true);
    setRawSignal(DEFAULT_RAW_SIGNAL);
    setForm(DEFAULT_FORM);
    setLotSize(null);
    setHasParsed(false);
    setScripInfo(null);
    resetContract();
    setRefreshing(false);
  };

  const set = (key: keyof typeof form) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const parseAndPrefill = async () => {
    const lines = rawSignal
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      Alert.alert('Invalid format', 'Please paste at least symbol and strike lines.');
      return;
    }

    const first = lines[0].toUpperCase();
    const second = lines[1].toUpperCase();

    const pickValue = (key: string): string => {
      const row = lines.find((line) => line.toUpperCase().startsWith(`${key}:`));
      if (!row) return '';
      return row.split(':').slice(1).join(':').trim();
    };

    const parsedPrice = pickValue('PRICE');
    const parsedStop = pickValue('STOPLOSS') || pickValue('STOP_LOSS');
    const parsedTarget = pickValue('TARGETS') || pickValue('TARGET');
    const parsedQty = pickValue('QTY') || pickValue('QUANTITY');
    const parsedExpiry = pickValue('EXPIRY'); // optional override — expiry is normally auto-fetched

    const parsedSegment = first.includes('SENSEX') || first.includes('BANKEX') ? 'BSE_FNO' : 'NSE_FNO';
    const parsedDirection = second.endsWith('PE') || second.endsWith('CE') ? 'BUY' : form.transaction_type;

    // Extract strike + option type from e.g. "23800PE" → strike=23800, optionType="PE"
    const optionMatch = second.match(/^(\d+(?:\.\d+)?)(PE|CE)$/);
    const parsedStrike = optionMatch ? optionMatch[1] : '';
    const parsedOptionType = optionMatch ? optionMatch[2] : '';

    // Pre-fill what we already know — security_id starts blank until scrip lookup resolves it
    setForm((prev) => ({
      ...prev,
      title: parsedExpiry ? `${first} ${second} ${parsedExpiry}` : `${first} ${second}`,
      exchange_segment: parsedSegment,
      security_id: '',
      transaction_type: parsedDirection,
      quantity: parsedQty || prev.quantity,
      price: parsedPrice || prev.price,
      target_price: parsedTarget || prev.target_price,
      stop_loss_price: parsedStop || prev.stop_loss_price,
      trailing_jump: prev.trailing_jump || '0',
    }));

    setHasParsed(true);
    setScripInfo(null);

    // Auto-lookup numeric security ID (and expiry, if not explicitly given) once we have strike + option type
    if (parsedStrike && parsedOptionType) {
      setLookingUp(true);
      try {
        const results = await adminApi.scripSearch({
          symbol: first,
          strike: parseFloat(parsedStrike),
          option_type: parsedOptionType,
          ...(parsedExpiry ? { expiry: parsedExpiry } : {}),
          exchange: parsedSegment === 'BSE_FNO' ? 'BSE' : 'NSE',
        });
        if (results.length > 0) {
          const match = results[0];
          setLotSize(match.lot_size);
          setForm((prev) => ({
            ...prev,
            title: `${first} ${second} ${match.expiry_date}`,
            security_id: match.security_id,
            exchange_segment: match.exchange_segment,
            // Auto-fill quantity from lot_size if not already set by admin
            quantity: prev.quantity || String(match.lot_size),
          }));
          setScripInfo({ found: true, tradingSymbol: match.trading_symbol, expiryDate: match.expiry_date });
        } else {
          setScripInfo({ found: false });
        }
      } catch (e: any) {
        setScripInfo({ found: false });
      } finally {
        setLookingUp(false);
      }
    }
  };

  const handleCreate = async () => {
    if (!form.title || !form.security_id || !form.quantity || !form.price || !form.target_price || !form.stop_loss_price) {
      Alert.alert('Missing fields', 'Please fill in all required fields.');
      return;
    }

    const payload = {
      title: form.title.trim(),
      exchange_segment: form.exchange_segment,
      security_id: form.security_id.trim(),
      transaction_type: form.transaction_type,
      product_type: form.product_type,
      order_type: form.order_type,
      quantity: parseInt(form.quantity, 10),
      price: parseFloat(form.price),
      target_price: parseFloat(form.target_price),
      stop_loss_price: parseFloat(form.stop_loss_price),
      trailing_jump: parseFloat(form.trailing_jump || '0'),
    };

    if (isNaN(payload.quantity) || isNaN(payload.price) || isNaN(payload.target_price) || isNaN(payload.stop_loss_price)) {
      Alert.alert('Invalid values', 'Price, quantity and stop loss must be valid numbers.');
      return;
    }

    setLoading(true);
    try {
      const signal = await adminApi.createSignal({
        ...payload,
        ...(lotSize != null ? { lot_size: lotSize } : {}),
        ...(selectedGroupIds.size > 0 ? { group_ids: Array.from(selectedGroupIds) } : {}),
      });
      Alert.alert(
        '\u2705 Signal Sent',
        `"${signal.title}" broadcast to ${selectedGroupIds.size > 0 ? `${selectedGroupIds.size} group${selectedGroupIds.size > 1 ? 's' : ''}` : 'all eligible users'}.`,
        [{ text: 'View Signal', onPress: () => router.replace({ pathname: '/(admin)/signal/[id]', params: { id: signal.id } }) }],
      );
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <AdminScreenHeader title="New Signal" onBack={() => router.back()} />

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[Colors.primary]}
              tintColor={Colors.primary}
            />
          }
        >
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, entryMode === 'quick' && styles.modeBtnActive]}
              onPress={() => setEntryMode('quick')}
            >
              <Text style={[styles.modeBtnText, entryMode === 'quick' && styles.modeBtnTextActive]}>Quick Select</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, entryMode === 'paste' && styles.modeBtnActive]}
              onPress={() => setEntryMode('paste')}
            >
              <Text style={[styles.modeBtnText, entryMode === 'paste' && styles.modeBtnTextActive]}>Paste Message</Text>
            </TouchableOpacity>
          </View>

          {entryMode === 'quick' && (
            <>
              <View style={styles.pasteCard}>
                {!quickSymbol ? (
                  <>
                    <Text style={styles.label}>Search Symbol</Text>
                    <TextInput
                      style={styles.input}
                      value={contractQuery}
                      onChangeText={handleContractQueryChange}
                      placeholder="e.g. NIFTY, BANKNIFTY, SENSEX…"
                      placeholderTextColor={Colors.textMuted}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />
                    {contractSearching && (
                      <View style={styles.parsedScripRow}>
                        <ActivityIndicator size="small" color={Colors.primary} />
                        <Text style={styles.parsedScripText}>Searching…</Text>
                      </View>
                    )}
                    {!contractSearching && contractQuery.trim().length > 0 && contractResults.length === 0 && (
                      <Text style={styles.parsedScripWarn}>⚠️ No matching contracts found.</Text>
                    )}
                    {contractResults.length > 0 && (
                      <View style={styles.suggestionList}>
                        {contractResults.map((c, idx) => (
                          <TouchableOpacity
                            key={`${c.symbol}-${c.expiry_date}-${c.option_type}`}
                            style={[styles.suggestionRow, idx === contractResults.length - 1 && { borderBottomWidth: 0 }]}
                            onPress={() => selectContract(c)}
                          >
                            <Text style={styles.suggestionText}>{c.symbol} · {c.expiry_date} · {c.option_type}</Text>
                            <Feather name="chevron-right" size={16} color={Colors.textMuted} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.label}>Contract</Text>
                    <View style={styles.contractChip}>
                      <Text style={styles.contractChipText}>{quickSymbol} · {quickExpiry} · {quickOptionType}</Text>
                      <TouchableOpacity onPress={resetContract} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Feather name="x" size={16} color={Colors.textMuted} />
                      </TouchableOpacity>
                    </View>

                    <Text style={[styles.label, { marginTop: Spacing.md }]}>Strike</Text>
                    {quickStrike == null ? (
                      <>
                        <TextInput
                          style={styles.input}
                          value={strikeSearchText}
                          onChangeText={setStrikeSearchText}
                          placeholder={quickLoadingStrikes ? 'Loading strikes…' : 'Search strike, e.g. 23800'}
                          placeholderTextColor={Colors.textMuted}
                          keyboardType="numeric"
                          editable={!quickLoadingStrikes}
                        />
                        {quickLoadingStrikes ? (
                          <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: Spacing.sm }} />
                        ) : (
                          <View style={styles.suggestionList}>
                            {filteredStrikes.slice(0, 12).map((s, idx) => (
                              <TouchableOpacity
                                key={s.strike}
                                style={[styles.suggestionRow, idx === Math.min(filteredStrikes.length, 12) - 1 && { borderBottomWidth: 0 }]}
                                onPress={() => selectQuickStrike(s.strike)}
                              >
                                <Text style={styles.suggestionText}>{s.strike} {quickOptionType}</Text>
                              </TouchableOpacity>
                            ))}
                            {filteredStrikes.length === 0 && (
                              <Text style={{ padding: Spacing.md, color: Colors.textMuted, textAlign: 'center' }}>No strikes match.</Text>
                            )}
                          </View>
                        )}
                      </>
                    ) : (
                      <View style={styles.contractChip}>
                        <Text style={styles.contractChipText}>{quickStrike} {quickOptionType}</Text>
                        <TouchableOpacity
                          onPress={() => { setQuickStrike(null); setScripInfo(null); setStrikeSearchText(''); }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Feather name="x" size={16} color={Colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </>
                )}
              </View>

              {lookingUp && (
                <View style={styles.parsedScripRow}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.parsedScripText}>Looking up security ID…</Text>
                </View>
              )}

              {scripInfo && !scripInfo.found && (
                <Text style={styles.parsedScripWarn}>⚠️ No contract found for {quickSymbol} {quickStrike}{quickOptionType} on {quickExpiry}.</Text>
              )}

              {scripInfo?.found && (
                <View style={styles.parsedPreview}>
                  <Text style={styles.parsedPreviewLabel}>Signal Preview</Text>
                  <Text style={styles.parsedTitle} numberOfLines={2}>{form.title}</Text>
                  <Text style={styles.parsedScripOk}>✅ {scripInfo.tradingSymbol} · ID: {form.security_id} · Expiry: {scripInfo.expiryDate}</Text>

                  <View style={styles.toggle}>
                    {(['BUY', 'SELL'] as const).map((t) => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.toggleBtn, form.transaction_type === t && (t === 'BUY' ? styles.buyActive : styles.sellActive)]}
                        onPress={() => set('transaction_type')(t)}
                      >
                        <Text style={[styles.toggleText, form.transaction_type === t && { color: '#fff' }]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Field label="Quantity *" value={form.quantity} onChangeText={set('quantity')} placeholder="e.g. 1300" keyboardType="numeric" />
                  <Field label="Entry Price *" value={form.price} onChangeText={set('price')} placeholder="3" keyboardType="decimal-pad" />
                  <Field label="Target Price *" value={form.target_price} onChangeText={set('target_price')} placeholder="15" keyboardType="decimal-pad" />
                  <Field label="Stop Loss Price *" value={form.stop_loss_price} onChangeText={set('stop_loss_price')} placeholder="0" keyboardType="decimal-pad" />
                  <Field label="Trailing Jump" value={form.trailing_jump} onChangeText={set('trailing_jump')} placeholder="0" keyboardType="decimal-pad" />

                  <AudiencePicker groups={groups} selectedGroupIds={selectedGroupIds} onPress={() => { setDraftGroupIds(new Set(selectedGroupIds)); setAudiencePickerVisible(true); }} />

                  <TouchableOpacity
                    style={[styles.submitBtn, loading && { opacity: 0.55 }]}
                    onPress={handleCreate}
                    disabled={loading}
                  >
                    {loading ? <ActivityIndicator color="#fff" /> : (
                      <View style={styles.submitContent}>
                        <Feather name="send" size={18} color="#fff" />
                        <Text style={styles.submitText}>Broadcast Signal</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {entryMode === 'paste' && (
            <View style={styles.pasteCard}>
              <Text style={styles.label}>Paste Signal Message</Text>
              <TextInput
                style={styles.pasteInput}
                value={rawSignal}
                onChangeText={setRawSignal}
                placeholder={'NIFTY\n23800PE\nPRICE: 3\nSTOPLOSS: 0\nTARGETS: 15\nQTY: 1300'}
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity style={[styles.parseBtn, lookingUp && { opacity: 0.6 }]} onPress={parseAndPrefill} disabled={lookingUp}>
                {lookingUp
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.parseBtnText}>Parse</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Parsed preview — shown inline in paste mode after parsing */}
          {entryMode === 'paste' && hasParsed && (
            <View style={styles.parsedPreview}>
              <Text style={styles.parsedPreviewLabel}>Signal Preview</Text>
              <Text style={styles.parsedTitle} numberOfLines={2}>{form.title || '(No title parsed)'}</Text>
              <View style={styles.parsedPriceRow}>
                <ParsCell label="Entry" value={`\u20b9${form.price || '\u2014'}`} />
                <ParsCell label="SL" value={`\u20b9${form.stop_loss_price || '\u2014'}`} danger />
                <ParsCell label="Target" value={`\u20b9${form.target_price || '\u2014'}`} success />
              </View>
              <View style={styles.parsedMetaRow}>
                <Text style={[styles.parsedBadge, form.transaction_type === 'BUY' ? styles.buyBadge : styles.sellBadge]}>{form.transaction_type}</Text>
                <Text style={styles.parsedMeta}>{form.exchange_segment}</Text>
                <Text style={styles.parsedMeta}>{form.product_type}</Text>
                <Text style={styles.parsedMeta}>Qty {form.quantity || '\u2014'}</Text>
              </View>
              {lookingUp && (
                <View style={styles.parsedScripRow}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.parsedScripText}>Looking up security ID…</Text>
                </View>
              )}
              {scripInfo?.found && (
                <Text style={styles.parsedScripOk}>✅ {scripInfo.tradingSymbol} · ID: {form.security_id} · Expiry: {scripInfo.expiryDate}</Text>
              )}
              {scripInfo && !scripInfo.found && (
                <Text style={styles.parsedScripWarn}>⚠️ Security ID not found for this contract.</Text>
              )}

              <AudiencePicker groups={groups} selectedGroupIds={selectedGroupIds} onPress={() => { setDraftGroupIds(new Set(selectedGroupIds)); setAudiencePickerVisible(true); }} />

              <TouchableOpacity
                style={[styles.submitBtn, loading && { opacity: 0.55 }]}
                onPress={handleCreate}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <View style={styles.submitContent}>
                    <Feather name="send" size={18} color="#fff" />
                    <Text style={styles.submitText}>Broadcast Signal</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Audience Picker Modal */}
      <Modal visible={audiencePickerVisible} transparent animationType="slide" onRequestClose={() => setAudiencePickerVisible(false)}>
        <Pressable style={audienceStyles.backdrop} onPress={() => setAudiencePickerVisible(false)} />
        <View style={audienceStyles.sheet}>
          <Text style={audienceStyles.sheetTitle}>Select Audience</Text>
          <Text style={audienceStyles.sheetSub}>Default: All eligible users. Select groups to target specific users.</Text>

          {/* All Users chip */}
          <TouchableOpacity
            style={[audienceStyles.groupRow, draftGroupIds.size === 0 && audienceStyles.groupRowSelected]}
            onPress={() => setDraftGroupIds(new Set())}
          >
            <View style={audienceStyles.groupRowInfo}>
              <Text style={audienceStyles.groupRowName}>All Users</Text>
              <Text style={audienceStyles.groupRowSub}>Broadcast to every eligible user</Text>
            </View>
            <View style={[audienceStyles.radio, draftGroupIds.size === 0 && audienceStyles.radioSelected]}>
              {draftGroupIds.size === 0 && <View style={audienceStyles.radioDot} />}
            </View>
          </TouchableOpacity>

          <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
            {groups.map((g) => {
              const sel = draftGroupIds.has(g.id);
              return (
                <TouchableOpacity
                  key={g.id}
                  style={[audienceStyles.groupRow, sel && audienceStyles.groupRowSelected]}
                  onPress={() => {
                    setDraftGroupIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                      return next;
                    });
                  }}
                >
                  <View style={audienceStyles.groupRowInfo}>
                    <Text style={audienceStyles.groupRowName}>{g.name}</Text>
                    <Text style={audienceStyles.groupRowSub}>{g.member_count} member{g.member_count !== 1 ? 's' : ''}</Text>
                  </View>
                  <View style={[audienceStyles.checkbox, sel && audienceStyles.checkboxSelected]}>
                    {sel && <Feather name="check" size={12} color="#fff" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={audienceStyles.confirmBtn}
            onPress={() => { setSelectedGroupIds(draftGroupIds); setAudiencePickerVisible(false); }}
          >
            <Text style={audienceStyles.confirmText}>
              {draftGroupIds.size > 0 ? `Target ${draftGroupIds.size} Group${draftGroupIds.size > 1 ? 's' : ''}` : 'Send to All Users'}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ParsCell({ label, value, danger, success }: { label: string; value: string; danger?: boolean; success?: boolean }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: '800', color: danger ? Colors.error : success ? Colors.success : Colors.text }}>{value}</Text>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default' }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: any;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
    gap: 6,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: Colors.primary,
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  modeBtnTextActive: {
    color: '#fff',
  },
  parsedPreview: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  parsedPreviewLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  parsedTitle: { ...Typography.h3, lineHeight: 24 },
  parsedPriceRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: Colors.background, borderRadius: Radius.sm, paddingVertical: 10 },
  parsedMetaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  parsedBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full, fontSize: 12, fontWeight: '700' as const, color: '#fff' },
  buyBadge: { backgroundColor: Colors.buy },
  sellBadge: { backgroundColor: Colors.sell },
  parsedMeta: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' as const },
  parsedScripRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  parsedScripText: { fontSize: 13, color: Colors.textMuted },
  parsedScripOk: { fontSize: 13, color: Colors.success, fontWeight: '600' as const, flex: 1 },
  parsedScripWarn: { fontSize: 13, color: Colors.warning, fontWeight: '600' as const, flex: 1 },
  pasteCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.card,
  },
  pasteInput: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    minHeight: 140,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  parseBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  parseBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  field: { gap: 6 },
  label: { ...Typography.label, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 12, fontSize: 15, color: Colors.text,
    backgroundColor: Colors.surface,
  },
  suggestionList: {
    marginTop: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.sm,
    backgroundColor: Colors.surface, overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  suggestionText: { fontSize: 14, fontWeight: '600', color: Colors.text },
  contractChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.primaryBg, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
  },
  contractChipText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  toggle: { flexDirection: 'row', gap: Spacing.sm },
  toggleBtn: {
    flex: 1, paddingVertical: 10, borderRadius: Radius.sm, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  buyActive: { backgroundColor: Colors.buy, borderColor: Colors.buy },
  sellActive: { backgroundColor: Colors.sell, borderColor: Colors.sell },
  toggleText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { color: '#fff' },
  preview: {
    backgroundColor: Colors.primaryBg, borderRadius: Radius.sm,
    padding: Spacing.md, gap: 4,
  },
  previewTitle: { ...Typography.label, color: Colors.primary, marginBottom: 4 },
  previewLine: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.sm,
    paddingVertical: 16, alignItems: 'center', marginTop: Spacing.sm,
  },
  submitContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

// ── Audience Picker helper component ──────────────────────────────────────────

function AudiencePicker({
  groups, selectedGroupIds, onPress,
}: {
  groups: UserGroup[];
  selectedGroupIds: Set<number>;
  onPress: () => void;
}) {
  const selectedGroups = groups.filter((g) => selectedGroupIds.has(g.id));
  return (
    <TouchableOpacity style={audienceStyles.row} onPress={onPress} activeOpacity={0.8}>
      <View style={audienceStyles.rowLeft}>
        <Text style={audienceStyles.rowLabel}>Audience</Text>
        {selectedGroups.length === 0 ? (
          <View style={audienceStyles.allChip}>
            <Feather name="users" size={12} color={Colors.primary} />
            <Text style={audienceStyles.allChipText}>All Users</Text>
          </View>
        ) : (
          <View style={audienceStyles.groupChips}>
            {selectedGroups.map((g) => (
              <View key={g.id} style={audienceStyles.groupChip}>
                <Text style={audienceStyles.groupChipText}>{g.name}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <Feather name="chevron-down" size={16} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

const audienceStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: Radius.sm,
    borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
  },
  rowLeft: { flex: 1, gap: 6 },
  rowLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  allChip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  allChipText: { fontSize: 14, color: Colors.primary, fontWeight: '700' },
  groupChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  groupChip: {
    backgroundColor: Colors.primaryBg, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.primary,
  },
  groupChipText: { fontSize: 12, color: Colors.primary, fontWeight: '700' },

  // Modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    padding: Spacing.lg, paddingBottom: 40,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  sheetSub: { fontSize: 13, color: Colors.textMuted, marginBottom: Spacing.md },
  groupRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    paddingHorizontal: Spacing.sm, borderRadius: Radius.sm, marginBottom: 4,
  },
  groupRowSelected: { backgroundColor: Colors.primaryBg },
  groupRowInfo: { flex: 1 },
  groupRowName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  groupRowSub: { fontSize: 12, color: Colors.textSecondary },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  confirmBtn: {
    marginTop: Spacing.md, backgroundColor: Colors.primary,
    borderRadius: Radius.sm, paddingVertical: 14, alignItems: 'center',
  },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
