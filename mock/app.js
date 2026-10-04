/**
 * 座敷わらし（Zashikiwarashi）
 * シミュレータースタジオ＆住民実機体験ステートマシン
 */

// Cockpit Elements
const btnTriggerBlackout = document.getElementById('btn-trigger-blackout');
const btnRestorePower = document.getElementById('btn-restore-power');
const iotPower = document.getElementById('iot-power');
const iotEv = document.getElementById('iot-ev');
const iotWifi = document.getElementById('iot-wifi');
const iotNeed = document.getElementById('iot-need');
const cockpitLog = document.getElementById('cockpit-log');

// Phone Elements
const netMode = document.getElementById('net-mode');
const pushNotification = document.getElementById('push-notification');
const mobileHomeVal = document.getElementById('mobile-home-val');

// Phone Screen Views
const viewLockscreen = document.getElementById('view-lockscreen');
const viewAppNormal = document.getElementById('view-app-normal');
const viewAppRequest = document.getElementById('view-app-request');
const viewAppConfirmed = document.getElementById('view-app-confirmed');
const viewAppDeclined = document.getElementById('view-app-declined');
const viewAppSuccess = document.getElementById('view-app-success');

const allPhoneViews = [
  viewLockscreen,
  viewAppNormal,
  viewAppRequest,
  viewAppConfirmed,
  viewAppDeclined,
  viewAppSuccess
];

// Interactive Buttons in Phone
const lockHint = document.getElementById('lock-hint');
const btnLockFromNormal = document.getElementById('btn-lock-from-normal');
const btnAcceptRequest = document.getElementById('btn-accept-request');
const btnDeclineRequest = document.getElementById('btn-decline-request');
const btnFinishDelivery = document.getElementById('btn-finish-delivery');
const btnReturnToLock1 = document.getElementById('btn-return-to-lock-1');
const btnReturnToLock2 = document.getElementById('btn-return-to-lock-2');

// 画面切り替えヘルパー
function showPhoneView(targetView) {
  allPhoneViews.forEach(v => {
    if (v) v.classList.add('hidden');
  });
  if (targetView) targetView.classList.remove('hidden');
}

// ログ出力ヘルパー
function addLog(source, msg) {
  if (!cockpitLog) return;
  const now = new Date().toTimeString().split(' ')[0];
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = `<span class="log-t">${now}</span><span class="log-s">[${source}]</span><span class="log-m">${msg}</span>`;
  cockpitLog.appendChild(div);
  cockpitLog.scrollTop = cockpitLog.scrollHeight;
}

// 初期ログ
addLog('System', '座敷わらし常駐エージェント起動。棟内全戸の暗号化見守り中。');
addLog('Privacy Gateway', '住民氏名・部屋番号の匿名化トークン化完了（平時手入力ゼロ）。');

// -------------------------------------------------------------
// 1. 停電シミュレーションのトリガー（外部操作卓）
// -------------------------------------------------------------
if (btnTriggerBlackout) {
  btnTriggerBlackout.addEventListener('click', () => {
    btnTriggerBlackout.classList.add('hidden');
    if (btnRestorePower) btnRestorePower.classList.remove('hidden');

    // 棟内物理状態の更新
    if (iotPower) {
      iotPower.textContent = '途絶（停電中）';
      iotPower.className = 'status-val alert';
    }
    if (iotEv) {
      iotEv.textContent = '緊急全基停止';
      iotEv.className = 'status-val alert';
    }
    if (iotWifi) {
      iotWifi.textContent = '一斉切断（4Gへ）';
      iotWifi.className = 'status-val alert';
    }
    if (iotNeed) {
      iotNeed.textContent = '14階 飲料水途絶';
      iotNeed.className = 'status-val alert';
    }

    // スマホのネットワーク状態が4Gにフォールバック
    if (netMode) netMode.textContent = '4G';
    if (mobileHomeVal) mobileHomeVal.textContent = '在宅（4G回線・Wi-Fi切断）';

    // ログ発火
    addLog('IoT Sensor', '棟内スマートメーター給電途絶。全戸Wi-Fiが一斉オフライン。');
    addLog('Building Agent', 'エレベーター全基停止を確認。1402号室（要支援）の給水Needを検知。');
    addLog('Vertex AI', '空間グラフ分割（バケツリレー）: 502号室（佐藤さん）へ1F➔8F（約4分）を割り当て。');
    addLog('FCM v1', '502号室の端末へ高優先度プッシュ通知を発行。');

    // ロック画面にプッシュ通知を着信させる
    showPhoneView(viewLockscreen);
    if (pushNotification) pushNotification.classList.remove('hidden');
  });
}

// -------------------------------------------------------------
// 2. 電力の復旧（通常へリセット）
// -------------------------------------------------------------
if (btnRestorePower) {
  btnRestorePower.addEventListener('click', () => {
    btnRestorePower.classList.add('hidden');
    if (btnTriggerBlackout) btnTriggerBlackout.classList.remove('hidden');

    if (iotPower) {
      iotPower.textContent = '給電中（通常）';
      iotPower.className = 'status-val ok';
    }
    if (iotEv) {
      iotEv.textContent = '通常運行中';
      iotEv.className = 'status-val ok';
    }
    if (iotWifi) {
      iotWifi.textContent = 'オンライン';
      iotWifi.className = 'status-val ok';
    }
    if (iotNeed) {
      iotNeed.textContent = 'なし';
      iotNeed.className = 'status-val neutral';
    }

    if (netMode) netMode.textContent = 'Wi-Fi';
    if (mobileHomeVal) mobileHomeVal.textContent = '在宅（自宅Wi-Fi）';

    if (pushNotification) pushNotification.classList.add('hidden');
    showPhoneView(viewLockscreen);

    addLog('System', '商用電源復旧。平時見守りモードへ戻りました。');
  });
}

// -------------------------------------------------------------
// 3. スマホ内インタラクション
// -------------------------------------------------------------

// ロック画面の通知をタップ ➔ アプリの打診画面へ
if (pushNotification) {
  pushNotification.addEventListener('click', () => {
    showPhoneView(viewAppRequest);
    addLog('Phone OS', '住民がプッシュ通知をタップ。座敷わらしアプリを起動。');
  });
}

// 平時のロック画面の控えめなヒント ➔ アプリ平時見守り画面へ
if (lockHint) {
  lockHint.addEventListener('click', () => {
    showPhoneView(viewAppNormal);
  });
}

// アプリ平時画面 ➔ ロック画面へ戻る
if (btnLockFromNormal) {
  btnLockFromNormal.addEventListener('click', () => {
    showPhoneView(viewLockscreen);
  });
}

// 「手伝える（約4分）」をタップ ➔ Progressive Disclosure（手順開示）
if (btnAcceptRequest) {
  btnAcceptRequest.addEventListener('click', () => {
    showPhoneView(viewAppConfirmed);
    addLog('Human Approval', '住民が「手伝える（約4分）」を承認。');
    addLog('Privacy Gateway', 'Progressive Disclosure 発効: 承認された区間（101号室前〜8階）を開示。');
  });
}

// 「今は無理」をタップ ➔ 罪悪感のない辞退画面へ
if (btnDeclineRequest) {
  btnDeclineRequest.addEventListener('click', () => {
    showPhoneView(viewAppDeclined);
    addLog('Human Response', '住民が「今は無理」を選択。ペナルティなし。');
    addLog('Building Agent', '近隣フロア（602号室 在宅候補）へ自動再ルーティングを実行。');
  });
}

// 「荷物を置いて完了」をタップ ➔ 感謝画面へ
if (btnFinishDelivery) {
  btnFinishDelivery.addEventListener('click', () => {
    showPhoneView(viewAppSuccess);
    addLog('Task Complete', '8階踊り場への運搬完了を検知。次走者へバトンタッチ。');
    addLog('Disaster Relief', '14階要支援世帯への飲料水搬送タスク完了。');
  });
}

// 完了/辞退画面からロック画面へ戻る
if (btnReturnToLock1) {
  btnReturnToLock1.addEventListener('click', () => {
    showPhoneView(viewLockscreen);
    if (pushNotification) pushNotification.classList.add('hidden');
  });
}

if (btnReturnToLock2) {
  btnReturnToLock2.addEventListener('click', () => {
    showPhoneView(viewLockscreen);
    if (pushNotification) pushNotification.classList.add('hidden');
  });
}
