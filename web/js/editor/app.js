import {
  createDefaultScene,
  validateSceneDocument,
  ASSETS,
  MATERIALS,
  TEMPLATE_TARGETS,
} from './document.js';
import { createHistory } from './history.js';
import { createDraftStore } from './persistence.js';
import { createSpaceRenderer } from './renderer.js';
import { requestJSON, requestCollection, establishSession } from './api.js';
import { startAgentTurn } from '../agent-client.js';

const $ = (selector) => document.querySelector(selector);
const readOnly = new URLSearchParams(location.search).has('share');
const editorSessionId = crypto.randomUUID();
const TAB_DRAFT_POINTER = 'loom-space-tab-draft-record';
const DRAFT_RECORD_ID_PATTERN = /^[A-Za-z0-9._-]{16,96}$/;
let tabDraftRecordId = null;
let tabStorageAvailable = true;
let draftLease = null;
let draftLeaseAvailable = true;
let draftLeaseClaimGeneration = 0;
try {
  const storedDraftRecordId = globalThis.sessionStorage?.getItem(TAB_DRAFT_POINTER);
  if (
    typeof storedDraftRecordId === 'string' &&
    DRAFT_RECORD_ID_PATTERN.test(storedDraftRecordId)
  ) {
    tabDraftRecordId = storedDraftRecordId;
  }
} catch {
  tabStorageAvailable = false;
}
let draftRecordId = crypto.randomUUID();
let draftKey = `draft:${draftRecordId}`;
const assetLabels = {
  'garden.bamboo-cluster': '竹丛',
  'garden.tree': '园林树',
  'garden.bench.wood': '木长椅',
  'garden.lamp': '园灯',
};
let history = createHistory(createDefaultScene());
let spaceId = crypto.randomUUID();
let savedRevision = null;
let savedJSON = null;
let renderer = null;
let draftStore = null;
let session = null;
let selectedId = null;
let saving = false;
let localFailure = false;
let conflict = false;
let conversationId = null;
let activeTurn = null;
let recoveredTurn = null;
let pendingAck = null;
let pendingSave = null;
let share = null;
let loadGeneration = 0;
let activeSave = null;
let retryAckButton = null;
let turnRecoveryPanel = null;
const pendingAckRequests = new WeakSet();
const pendingTurnRequests = new WeakSet();
let saveQueue = Promise.resolve();
let noticeTimer;
document.body.classList.toggle('read-only', readOnly);

function showNotice(message, tone = 'info') {
  clearTimeout(noticeTimer);
  $('#notice').textContent = message;
  $('#notice').dataset.tone = tone;
  $('#notice').hidden = false;
  if (tone === 'success')
    noticeTimer = setTimeout(() => {
      $('#notice').hidden = true;
    }, 7000);
}

function describeError(error) {
  if (error.status === 401) {
    session = null;
    refreshStatus();
    return '这个浏览器的访问凭证已失效。草稿仍在本地，请先导出备份再刷新。原来保存的空间无法自动找回。';
  }
  if (error.status === 404)
    return '无法打开这份空间，请确认使用的是保存它的浏览器。当前草稿已保留。';
  if (error.status === 413) return '内容太大，请减少物件或缩短描述后再试。';
  if (error.status === 429) return '操作太频繁或可用额度已用完。请稍后再试，草稿已保留。';
  if (error.status === 503) return '暂时无法连接云端。可以继续在这里编辑和导出备份。';
  return /[\p{Script=Han}]/u.test(error.message || '')
    ? error.message
    : '操作没有完成，请稍后再试。草稿已保留。';
}

function refreshStatus() {
  const dirty = savedJSON !== JSON.stringify(history.scene);
  $('#save-status').textContent = localFailure
    ? '本地保存失败 · 请导出备份'
    : saving
      ? '正在保存…'
      : conflict
        ? '发现另一份修改 · 草稿已保留'
        : dirty
          ? session
            ? '本地草稿 · 尚未同步'
            : '本地草稿'
          : '已保存';
  $('#save-scene').disabled = !session || saving || readOnly;
  $('#undo').disabled = !history.canUndo || readOnly;
  $('#redo').disabled = !history.canRedo || readOnly;
  $('#share-scene').disabled = !savedRevision || !session || saving || readOnly;
  const agentReady = Boolean(session?.agentEnabled && savedRevision && !readOnly);
  $('#agent-prompt').disabled = !agentReady || Boolean(recoveredTurn);
  $('#agent-send').disabled =
    !agentReady || Boolean(activeTurn) || Boolean(recoveredTurn) || Boolean(pendingAck);
  $('#agent-stop').hidden = !activeTurn;
  $('#agent-status').textContent = activeTurn
    ? '正在设计…你可以随时停止。'
    : pendingAck
      ? '修改已放进草稿，但助手还未收到确认。请点击“重试确认修改”。'
      : recoveredTurn
        ? '上次的助手任务还没有确认结果。可以查询进度或关闭提示。'
        : !session
          ? '可以在这个浏览器里布置空间和导出备份。'
          : !session.agentEnabled
            ? '助手尚未启用。仍可手动布置、保存和导出。'
            : !savedRevision
              ? '先保存一次空间，就可以开始对话设计。'
              : '已连接 · 只修改当前草稿，可随时撤销。';
}

function snapshotDraft() {
  return {
    kind: 'loom-draft',
    draftRecordId,
    editorSessionId,
    spaceId,
    scene: structuredClone(history.scene),
    history: history.snapshot?.() ?? null,
    savedRevision,
    savedJSON,
    pendingSave,
    pendingTurn: turnSummary(activeTurn) || recoveredTurn,
    pendingAck,
    updatedAt: new Date().toISOString(),
  };
}

function rememberDraftRecord() {
  try {
    globalThis.sessionStorage.setItem(TAB_DRAFT_POINTER, draftRecordId);
    tabDraftRecordId = draftRecordId;
    tabStorageAvailable = true;
    return true;
  } catch {
    tabStorageAvailable = false;
    return false;
  }
}

function releaseDraftLease() {
  draftLeaseClaimGeneration++;
  const lease = draftLease;
  if (!lease) return;
  draftLease = null;
  lease.release?.();
  lease.channel?.close();
}

async function claimDraftLease(recordId) {
  if (draftLease?.id === recordId) return true;
  const generation = ++draftLeaseClaimGeneration;
  if (typeof navigator.locks?.request !== 'function') {
    draftLeaseAvailable = false;
    return false;
  }
  let settled = false;
  let resolveClaim;
  const claimed = new Promise((resolve) => {
    resolveClaim = resolve;
  });
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const failClaim = () => {
    draftLeaseAvailable = false;
    if (!settled) {
      settled = true;
      resolveClaim(false);
    }
  };
  try {
    Promise.resolve(
      navigator.locks.request(
        `loom-draft-record:${recordId}`,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) {
            settled = true;
            resolveClaim(false);
            return;
          }
          if (generation !== draftLeaseClaimGeneration || recordId !== draftRecordId) {
            settled = true;
            resolveClaim(false);
            return;
          }
          const lease = { id: recordId, release };
          draftLease = lease;
          settled = true;
          resolveClaim(true);
          await hold;
          if (draftLease === lease) draftLease = null;
        },
      ),
    ).catch(failClaim);
  } catch {
    failClaim();
  }
  return claimed;
}

function startIndependentDraftRecord() {
  releaseDraftLease();
  draftRecordId = crypto.randomUUID();
  draftKey = `draft:${draftRecordId}`;
  void claimDraftLease(draftRecordId);
  rememberDraftRecord();
}

function persistDraft() {
  if (readOnly || !draftStore) return;
  const snapshot = snapshotDraft();
  const key = draftKey;
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => draftStore.save(key, snapshot))
    .then(() => {
      localFailure = false;
      refreshStatus();
    })
    .catch(() => {
      localFailure = true;
      refreshStatus();
      showNotice('浏览器未能保存本地草稿，可能是空间不足或存储被禁用。请立即导出备份。', 'error');
    });
}

function recoverPendingSave(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (
    typeof value.saveAttemptId !== 'string' ||
    !/^[A-Za-z0-9._-]{16,96}$/.test(value.saveAttemptId) ||
    (value.parentRevisionId !== null && typeof value.parentRevisionId !== 'string') ||
    typeof value.sceneJSON !== 'string' ||
    value.sceneJSON.length > 256 * 1024
  )
    return null;
  try {
    const scene = validateSceneDocument(JSON.parse(value.sceneJSON));
    if (JSON.stringify(scene) !== value.sceneJSON) return null;
    return {
      saveAttemptId: value.saveAttemptId,
      parentRevisionId: value.parentRevisionId,
      sceneJSON: value.sceneJSON,
    };
  } catch {
    return null;
  }
}

function recoverPendingAck(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const {
    spaceId: targetSpace,
    turnId,
    proposalId,
    conversationId: targetConversation,
    editorSessionId: targetEditor,
    baseDraftVersion,
    appliedDraftVersion,
    outcome,
  } = value;
  if (
    typeof targetSpace !== 'string' ||
    !/^[A-Za-z0-9._-]{16,96}$/.test(targetSpace) ||
    typeof turnId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(turnId) ||
    typeof proposalId !== 'string' ||
    !/^pr_[A-Za-z0-9_-]{16,80}$/.test(proposalId) ||
    typeof targetConversation !== 'string' ||
    !/^[A-Za-z0-9._-]{6,36}$/.test(targetConversation) ||
    typeof targetEditor !== 'string' ||
    !/^[A-Za-z0-9._-]{8,80}$/.test(targetEditor) ||
    !Number.isSafeInteger(baseDraftVersion) ||
    !Number.isSafeInteger(appliedDraftVersion) ||
    appliedDraftVersion !== baseDraftVersion + 1 ||
    outcome !== 'scene_applied'
  )
    return null;
  return {
    spaceId: targetSpace,
    turnId,
    proposalId,
    conversationId: targetConversation,
    editorSessionId: targetEditor,
    baseDraftVersion,
    appliedDraftVersion,
    outcome,
  };
}

function recoverPendingTurn(value, targetSpace) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const {
    turnId,
    conversationId: targetConversation,
    editorSessionId: targetEditor,
    baseDraftVersion,
    lastEventId,
  } = value;
  if (
    (value.spaceId != null && value.spaceId !== targetSpace) ||
    typeof turnId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(turnId) ||
    (targetConversation !== null &&
      (typeof targetConversation !== 'string' ||
        !/^[A-Za-z0-9._-]{6,36}$/.test(targetConversation))) ||
    typeof targetEditor !== 'string' ||
    !/^[A-Za-z0-9._-]{8,80}$/.test(targetEditor) ||
    !Number.isSafeInteger(baseDraftVersion) ||
    baseDraftVersion < 0 ||
    (lastEventId != null && (typeof lastEventId !== 'string' || lastEventId.length > 120))
  )
    return null;
  return {
    spaceId: targetSpace,
    turnId,
    conversationId: targetConversation ?? null,
    editorSessionId: targetEditor,
    baseDraftVersion,
    lastEventId: lastEventId || null,
  };
}

function turnSummary(turn) {
  if (!turn) return null;
  const {
    turnId,
    conversationId: targetConversation,
    editorSessionId: targetEditor,
    baseDraftVersion,
    lastEventId,
  } = turn;
  if (!turnId || !targetEditor) return null;
  return {
    spaceId: turn.spaceId,
    turnId,
    conversationId: targetConversation || null,
    editorSessionId: targetEditor,
    baseDraftVersion,
    lastEventId: lastEventId || null,
  };
}

function updateRecoveredTurnControls() {
  if (!recoveredTurn) {
    turnRecoveryPanel?.remove();
    turnRecoveryPanel = null;
    return;
  }
  if (!turnRecoveryPanel) {
    turnRecoveryPanel = document.createElement('div');
    turnRecoveryPanel.className = 'message assistant-message';
    const description = document.createElement('p');
    description.textContent =
      '上次的助手任务还没有确认结果。查询进度不会重新发送任务，也不会改动草稿。关闭提示不会停止上次的任务；重新发送可能另行计费。';
    const query = document.createElement('button');
    query.type = 'button';
    query.textContent = '查询上次任务状态';
    query.addEventListener('click', async () => {
      const turn = recoveredTurn;
      if (!turn || pendingTurnRequests.has(turn)) return;
      pendingTurnRequests.add(turn);
      query.disabled = true;
      try {
        if (!turn.conversationId) {
          addMessage('上次连接中断，没有留下可查询的任务记录。可以关闭这条提示。');
          return;
        }
        const targetGeneration = loadGeneration;
        const targetDraftRecordId = draftRecordId;
        const result = await requestJSON(
          `/api/v1/spaces/${turn.spaceId}/agent/turns/${turn.turnId}`,
          {
            headers: { 'Makers-Conversation-Id': turn.conversationId },
          },
        );
        if (
          recoveredTurn !== turn ||
          loadGeneration !== targetGeneration ||
          draftRecordId !== targetDraftRecordId
        )
          return;
        const labels = {
          running: '记录显示，助手还在处理。这里不会自动接收结果或修改草稿。',
          proposal_ready:
            '助手已生成修改建议，这里不会自动应用。请先检查草稿，再决定是否重新提出要求。',
          applied: '这组修改已确认。查询进度不会改变当前草稿。',
          failed: '助手未能完成这次任务，草稿保持原样。',
          cancel_requested: '停止请求已送达。查询进度不会应用之后返回的结果。',
          unknown: '暂时查不到这次任务的进度，草稿保持原样。',
        };
        if (result.turnId !== turn.turnId || !Object.hasOwn(labels, result.status))
          throw new Error('暂时无法确认任务进度，请稍后再查。');
        addMessage(labels[result.status]);
        if (
          result.status === 'applied' &&
          pendingAck?.turnId === turn.turnId &&
          pendingAck.spaceId === turn.spaceId
        ) {
          pendingAck = null;
          updatePendingAckRetryButton();
        }
        if (result.status === 'applied') recoveredTurn = null;
        refreshStatus();
        persistDraft();
        updateRecoveredTurnControls();
      } catch (error) {
        if (recoveredTurn === turn) addMessage(describeError(error), 'assistant');
      } finally {
        pendingTurnRequests.delete(turn);
        if (recoveredTurn === turn && query.isConnected) query.disabled = false;
      }
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = '关闭这条提示';
    clear.addEventListener('click', () => {
      const turn = recoveredTurn;
      if (!turn) return;
      recoveredTurn = null;
      updateRecoveredTurnControls();
      persistDraft();
      refreshStatus();
      addMessage('提示已关闭。上次的任务和当前草稿没有改变。');
    });
    turnRecoveryPanel.append(description, query, clear);
    $('#conversation').append(turnRecoveryPanel);
  }
}

function updatePendingAckRetryButton() {
  if (!pendingAck) {
    retryAckButton?.remove();
    retryAckButton = null;
    return;
  }
  if (!retryAckButton) {
    retryAckButton = document.createElement('button');
    retryAckButton.type = 'button';
    retryAckButton.id = 'retry-agent-ack';
    retryAckButton.textContent = '重试确认修改';
    retryAckButton.addEventListener('click', async () => {
      const acknowledgement = pendingAck;
      if (!acknowledgement) return;
      retryAckButton.disabled = true;
      await retryPendingAck(acknowledgement);
      if (pendingAck === acknowledgement && retryAckButton) retryAckButton.disabled = false;
    });
    $('#conversation').append(retryAckButton);
  }
}

function updateInspector() {
  const object = history.scene.objects.find((item) => item.id === selectedId);
  $('#object-inspector').hidden = !object;
  if (!object) {
    selectedId = null;
    renderer?.setSelection(null);
    return;
  }
  $('#object-name').value = object.name;
  $('#object-material').replaceChildren(
    ...ASSETS[object.assetId].materialIds.map((id) => new Option(MATERIALS[id].label, id)),
  );
  $('#object-material').value = object.materialId;
  for (const input of document.querySelectorAll('[data-vector]')) {
    const value = object.transform[input.dataset.vector][Number(input.dataset.axis)];
    input.value = Number(
      (input.dataset.vector === 'rotation' ? (value * 180) / Math.PI : value).toFixed(3),
    );
  }
}

function refreshControls() {
  const scene = history.scene;
  $('#scene-title').value = scene.title;
  $('#sky-preset').value = scene.environment.skyPreset;
  $('#time-of-day').value = scene.environment.timeOfDay;
  const hours = Math.floor(scene.environment.timeOfDay);
  $('#time-label').textContent =
    `${String(hours).padStart(2, '0')}:${String(Math.round((scene.environment.timeOfDay - hours) * 60)).padStart(2, '0')}`;
  $('#sun-intensity').value = scene.environment.sunIntensity;
  $('#ambient-intensity').value = scene.environment.ambientIntensity;
  $('#doors-open').checked = scene.environment.doorState === 'open';
  $('#landscape-visible').checked = scene.environment.landscapeVisible;
  for (const [selector, targetId] of [
    ['#frame-material', 'pavilion.frame'],
    ['#roof-material', 'pavilion.roof'],
    ['#glass-material', 'pavilion.glass'],
  ]) {
    $(selector).value =
      scene.templateOverrides.find((item) => item.targetId === targetId)?.materialId || '';
  }
  $('#object-list').replaceChildren(
    ...scene.objects.map((object) => new Option(object.name, object.id)),
  );
  $('#object-list').value = selectedId || '';
  $('#objects-empty').hidden = scene.objects.length > 0;
  updateInspector();
  refreshStatus();
}

function renderDocument({ preserveCamera = true } = {}) {
  try {
    renderer?.setScene(history.scene, { preserveCamera });
  } catch {
    showNotice('空间画面暂时没有更新。修改仍在草稿中，请先导出备份再刷新。', 'error');
  }
  renderer?.setSelection(selectedId);
}

function edit(change, { preserveCamera = true } = {}) {
  if (readOnly) return false;
  try {
    change();
    refreshControls();
    renderDocument({ preserveCamera });
    persistDraft();
    return true;
  } catch (error) {
    showNotice(describeError(error), 'error');
    refreshControls();
    renderDocument();
    return false;
  }
}

function apply(operations) {
  return edit(() => history.apply(operations), {
    preserveCamera: !operations.some((op) => op.op === 'set_camera'),
  });
}

function selectObject(id) {
  selectedId = id;
  $('#object-list').value = id || '';
  updateInspector();
  renderer?.setSelection(selectedId);
}

function loadScene(
  scene,
  {
    id = crypto.randomUUID(),
    revision = null,
    saved = null,
    recovered = false,
    historySnapshot = null,
    pendingSave: pendingSaveCandidate = null,
    pendingSaveSpaceId = null,
    pendingAck: pendingAckCandidate = null,
    pendingTurn: pendingTurnCandidate = null,
  } = {},
) {
  const validatedScene = validateSceneDocument(scene);
  if (activeTurn) stopTurn();
  persistDraft();
  loadGeneration++;
  activeSave = null;
  saving = false;
  if (!readOnly) startIndependentDraftRecord();
  history = createHistory(validatedScene);
  if (historySnapshot) {
    try {
      history.restore(historySnapshot);
    } catch {
      showNotice('空间已恢复，之前的撤销记录暂时无法找回。');
    }
  }
  spaceId = id;
  savedRevision = revision;
  savedJSON = saved;
  selectedId = null;
  const sceneJSON = JSON.stringify(validatedScene);
  const restoredSave = recoverPendingSave(pendingSaveCandidate);
  pendingSave =
    pendingSaveSpaceId === id &&
    restoredSave?.sceneJSON === sceneJSON &&
    restoredSave.parentRevisionId === revision
      ? restoredSave
      : null;
  conversationId = null;
  pendingAck = recoverPendingAck(pendingAckCandidate);
  if (pendingAck?.spaceId !== id) pendingAck = null;
  recoveredTurn = recoverPendingTurn(pendingTurnCandidate, id);
  conflict = false;
  share = null;
  $('#confirm-share').disabled = false;
  $('#confirm-share').hidden = false;
  $('#share-result').hidden = true;
  $('#copy-share').hidden = true;
  $('#revoke-share').hidden = true;
  updatePendingAckRetryButton();
  updateRecoveredTurnControls();
  refreshControls();
  renderDocument({ preserveCamera: false });
  persistDraft();
  if (recovered)
    showNotice(
      pendingAck
        ? '已打开草稿副本。有一项修改还需确认，可以重试，不会重复修改。'
        : pendingSave
          ? '已打开草稿副本。可以继续保存，不会重复创建同一条保存记录。'
          : '草稿副本已恢复。云端内容仍保留，保存前可以到“我的空间”查看。',
    );
}

async function saveScene() {
  if (!session || saving || readOnly) return;
  const scene = structuredClone(history.scene);
  const sceneJSON = JSON.stringify(scene);
  if (
    !pendingSave ||
    pendingSave.sceneJSON !== sceneJSON ||
    pendingSave.parentRevisionId !== savedRevision
  ) {
    pendingSave = {
      saveAttemptId: crypto.randomUUID(),
      parentRevisionId: savedRevision,
      sceneJSON,
    };
  }
  const pendingAttempt = pendingSave;
  const attempt = { ...pendingSave };
  const targetSpace = spaceId;
  const targetGeneration = loadGeneration;
  const targetDraftRecordId = draftRecordId;
  const saveContext = { targetGeneration, targetDraftRecordId };
  activeSave = saveContext;
  saving = true;
  refreshStatus();
  persistDraft();
  try {
    const result = await requestJSON(`/api/v1/spaces/${targetSpace}/revisions`, {
      method: 'PUT',
      body: {
        saveAttemptId: attempt.saveAttemptId,
        parentRevisionId: attempt.parentRevisionId,
        scene,
      },
    });
    if (
      loadGeneration !== targetGeneration ||
      draftRecordId !== targetDraftRecordId ||
      spaceId !== targetSpace ||
      activeSave !== saveContext
    )
      return;
    savedRevision = result.revisionId;
    savedJSON = sceneJSON;
    if (pendingSave === pendingAttempt) pendingSave = null;
    conflict = Boolean(result.siblings?.length || result.siblingRevisions?.length);
    showNotice(
      conflict
        ? '空间已保存，也发现了另一份修改。两份内容都已保留，可在“我的空间”中选择。'
        : '空间已保存到云端，下次可用这个浏览器继续打开。',
      'success',
    );
  } catch (error) {
    if (error.status === 401) {
      const message = describeError(error);
      if (
        loadGeneration === targetGeneration &&
        draftRecordId === targetDraftRecordId &&
        spaceId === targetSpace
      )
        showNotice(message, 'error');
    } else if (
      loadGeneration === targetGeneration &&
      draftRecordId === targetDraftRecordId &&
      spaceId === targetSpace
    ) {
      showNotice(describeError(error), 'error');
    }
  } finally {
    if (activeSave === saveContext) {
      activeSave = null;
      saving = false;
      refreshStatus();
      persistDraft();
    }
  }
}

function exportScene() {
  const bytes = JSON.stringify(validateSceneDocument(history.scene), null, 2);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `loom-space-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function addMessage(text, role = 'assistant') {
  const element = document.createElement('div');
  element.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;
  element.textContent = text;
  $('#conversation').append(element);
  $('#conversation').scrollTop = $('#conversation').scrollHeight;
  return element;
}

async function retryPendingAck(acknowledgement) {
  if (!acknowledgement || pendingAckRequests.has(acknowledgement)) return;
  pendingAckRequests.add(acknowledgement);
  try {
    const {
      spaceId: target,
      turnId,
      conversationId: targetConversation,
      ...body
    } = acknowledgement;
    await requestJSON(`/api/v1/spaces/${target}/agent/turns/${turnId}/ack`, {
      method: 'POST',
      body,
      headers: { 'Makers-Conversation-Id': targetConversation },
    });
    if (pendingAck === acknowledgement) {
      pendingAck = null;
      updatePendingAckRetryButton();
      refreshStatus();
      persistDraft();
    }
  } catch (error) {
    const message =
      error.status === 401
        ? describeError(error)
        : '修改已应用到本地草稿，但确认尚未送达。可以重试确认，不会再次应用操作。';
    if (pendingAck === acknowledgement) {
      showNotice(message, 'error');
      updatePendingAckRetryButton();
    }
  } finally {
    pendingAckRequests.delete(acknowledgement);
  }
}

async function acknowledge(turn, proposal) {
  const acknowledgement = {
    spaceId: turn.spaceId,
    turnId: turn.turnId,
    proposalId: proposal.proposalId,
    conversationId: turn.conversationId,
    editorSessionId: turn.editorSessionId,
    baseDraftVersion: proposal.baseDraftVersion,
    appliedDraftVersion: history.version,
    outcome: 'scene_applied',
  };
  pendingAck = acknowledgement;
  updatePendingAckRetryButton();
  persistDraft();
  await retryPendingAck(acknowledgement);
}

async function runTurn(prompt) {
  if (
    activeTurn ||
    recoveredTurn ||
    pendingAck ||
    !session?.agentEnabled ||
    !savedRevision ||
    !prompt.trim()
  )
    return;
  const turn = {
    turnId: crypto.randomUUID(),
    spaceId,
    loadGeneration,
    draftRecordId,
    editorSessionId,
    baseDraftVersion: history.version,
    draftScene: structuredClone(history.scene),
    controller: new AbortController(),
    proposal: null,
    applied: false,
  };
  activeTurn = turn;
  refreshStatus();
  persistDraft();
  addMessage(prompt, 'user');
  const reply = addMessage('正在想一想，怎样让这里更适合你…');
  try {
    if (!conversationId) {
      const result = await requestJSON(`/api/v1/spaces/${turn.spaceId}/agent/sessions`, {
        method: 'POST',
        body: { editorSessionId: turn.editorSessionId },
        signal: turn.controller.signal,
      });
      if (
        activeTurn !== turn ||
        loadGeneration !== turn.loadGeneration ||
        turn.controller.signal.aborted
      )
        return;
      turn.conversationId = result.conversationId;
      conversationId = turn.conversationId;
    } else {
      turn.conversationId = conversationId;
    }
    if (
      activeTurn !== turn ||
      loadGeneration !== turn.loadGeneration ||
      turn.controller.signal.aborted
    )
      return;
    persistDraft();
    await startAgentTurn({
      conversationId: turn.conversationId,
      signal: turn.controller.signal,
      body: {
        action: 'start',
        spaceId: turn.spaceId,
        turnId: turn.turnId,
        editorSessionId: turn.editorSessionId,
        baseDraftVersion: turn.baseDraftVersion,
        draftScene: turn.draftScene,
        prompt,
      },
      onEvent: async ({ type, id, data }) => {
        if (
          activeTurn !== turn ||
          loadGeneration !== turn.loadGeneration ||
          turn.controller.signal.aborted
        )
          return;
        if (data.turnId !== turn.turnId) return;
        turn.lastEventId = id;
        if (type === 'error') {
          turn.terminalFailure = true;
          throw new Error(data.message || '助手未能完成，草稿未被更改。');
        }
        if (type === 'proposal') {
          if (
            data.editorSessionId !== turn.editorSessionId ||
            data.baseDraftVersion !== turn.baseDraftVersion
          ) {
            turn.terminalFailure = true;
            throw new Error('这份建议与当前空间不一致，未作修改。');
          }
          turn.proposal = data;
        }
        if (type === 'proposal_ready' && !turn.applied) {
          const proposal = turn.proposal;
          if (
            !proposal ||
            data.proposalId !== proposal.proposalId ||
            data.editorSessionId !== turn.editorSessionId ||
            data.baseDraftVersion !== turn.baseDraftVersion
          ) {
            turn.terminalFailure = true;
            throw new Error('助手的修改建议不完整，草稿保持原样。');
          }
          if (history.version !== turn.baseDraftVersion || spaceId !== turn.spaceId) {
            turn.terminalFailure = true;
            throw new Error('你已经调整了空间，助手之前的建议没有应用。请按当前草稿重新描述。');
          }
          if (!apply(proposal.operations)) {
            turn.terminalFailure = true;
            throw new Error('这份建议暂时无法用于当前空间，草稿保持原样。');
          }
          turn.applied = true;
          reply.textContent = '已应用到当前草稿。你可以继续调整、撤销，或点击“保存到云端”。';
          await acknowledge(turn, proposal);
        }
      },
    });
    if (!turn.applied && activeTurn === turn)
      reply.textContent =
        '连接已断开，尚未收到完整的修改建议。草稿已保留；为避免再次计费，不会自动重新发送。';
  } catch (error) {
    if (!turn.applied && [400, 401, 404].includes(error.status)) turn.terminalFailure = true;
    if (turn.applied)
      reply.textContent = '修改已放进草稿。连接断开后修改仍然保留，你可以撤销或保存。';
    else
      reply.textContent = turn.controller.signal.aborted
        ? '已停止接收结果，之后返回的修改不会应用。服务商仍可能对已开始的任务计费。'
        : describeError(error);
  } finally {
    if (activeTurn === turn) activeTurn = null;
    if (
      loadGeneration === turn.loadGeneration &&
      spaceId === turn.spaceId &&
      draftRecordId === turn.draftRecordId
    ) {
      recoveredTurn = turn.applied || turn.terminalFailure ? null : turnSummary(turn);
      updateRecoveredTurnControls();
      refreshStatus();
      persistDraft();
    }
  }
}

function stopTurn() {
  const turn = activeTurn;
  if (!turn) return;
  turn.controller.abort();
  activeTurn = null;
  recoveredTurn = turnSummary(turn);
  updateRecoveredTurnControls();
  showNotice('已停止接收结果，并发送取消请求。服务商仍可能继续处理并计费。');
  if (turn.conversationId) {
    requestJSON(`/api/v1/spaces/${turn.spaceId}/agent/turns/${turn.turnId}/cancel`, {
      method: 'POST',
      body: {},
      headers: { 'Makers-Conversation-Id': turn.conversationId },
    }).catch((error) => {
      if (error.status === 401) showNotice(describeError(error), 'error');
    });
  }
  refreshStatus();
  persistDraft();
}

function libraryRow(group, title, detail, action, { conflict: branch = false } = {}) {
  const row = document.createElement('div');
  row.className = 'library-item';
  row.dataset.conflict = branch;
  const text = document.createElement('span');
  text.textContent = title;
  const small = document.createElement('small');
  small.textContent = detail;
  text.append(small);
  const open = document.createElement('button');
  open.textContent = '打开副本';
  open.addEventListener('click', async () => {
    if (
      savedJSON !== JSON.stringify(history.scene) &&
      !confirm('打开后当前草稿仍保留在本地列表。确定切换吗？')
    )
      return;
    open.disabled = true;
    try {
      await action();
      $('#library-dialog').close();
    } catch (error) {
      showNotice(describeError(error), 'error');
    } finally {
      open.disabled = false;
    }
  });
  row.append(text, open);
  group.append(row);
}

function libraryGroup(title) {
  const group = document.createElement('section');
  group.className = 'library-group';
  const heading = document.createElement('h3');
  heading.textContent = title;
  group.append(heading);
  $('#library-content').append(group);
  return group;
}

async function openLibrary() {
  $('#library-content').replaceChildren();
  $('#library-dialog').showModal();
  await saveQueue;
  const local = libraryGroup('这个浏览器的本地草稿');
  try {
    const drafts = ((await draftStore?.list('draft:')) || [])
      .map(({ value }) => value)
      .filter((item) => item.kind === 'loom-draft')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const draft of drafts) {
      libraryRow(
        local,
        draft.scene.title,
        `${new Date(draft.updatedAt).toLocaleString()} · 本地草稿`,
        () =>
          loadScene(draft.scene, {
            id: draft.spaceId,
            revision: draft.savedRevision,
            saved: draft.savedJSON,
            recovered: true,
            historySnapshot: draft.history,
            pendingSave: draft.pendingSave,
            pendingSaveSpaceId: draft.spaceId,
            pendingAck: draft.pendingAck,
            pendingTurn: draft.pendingTurn,
          }),
      );
    }
    if (!drafts.length) local.append(document.createTextNode('还没有可恢复的本地草稿。'));
  } catch {
    local.append(document.createTextNode('暂时无法读取这个浏览器里的草稿，请先导出当前内容。'));
  }
  if (!session) return;
  const cloud = libraryGroup('已保存的空间');
  try {
    const spaces = await requestCollection('/api/v1/spaces', 'spaces');
    for (const space of spaces) {
      const versions = Array.isArray(space.revisions)
        ? space.revisions
        : await requestCollection(`/api/v1/spaces/${space.spaceId}/revisions`, 'revisions');
      const parents = new Set(
        versions.map((revision) => revision.parentRevisionId).filter(Boolean),
      );
      const heads = versions.filter((revision) => !parents.has(revision.revisionId));
      for (const [index, revision] of versions.entries()) {
        libraryRow(
          cloud,
          space.title || '未命名空间',
          `${!parents.has(revision.revisionId) ? (heads.length > 1 ? '另一份修改' : '最近保存') : '较早保存'} · 保存记录 ${index + 1}`,
          async () => {
            const targetGeneration = loadGeneration;
            const saved = await requestJSON(
              `/api/v1/spaces/${space.spaceId}/revisions/${revision.revisionId}`,
            );
            if (loadGeneration !== targetGeneration) return;
            loadScene(saved.scene, {
              id: space.spaceId,
              revision: saved.revisionId,
              saved: JSON.stringify(validateSceneDocument(saved.scene)),
            });
          },
          { conflict: heads.length > 1 && !parents.has(revision.revisionId) },
        );
      }
    }
    if (!spaces.length)
      cloud.append(document.createTextNode('还没有已保存的空间，点击“保存到云端”留下第一份。'));
  } catch (error) {
    cloud.append(document.createTextNode(describeError(error)));
  }
}

function bindEvents() {
  $('#scene-title').addEventListener('change', (event) =>
    edit(() => history.replace({ ...history.scene, title: event.target.value })),
  );
  $('#undo').addEventListener('click', () => edit(() => history.undo(), { preserveCamera: false }));
  $('#redo').addEventListener('click', () => edit(() => history.redo(), { preserveCamera: false }));
  $('#save-scene').addEventListener('click', saveScene);
  $('#new-scene').addEventListener('click', () => {
    if (
      savedJSON !== JSON.stringify(history.scene) &&
      !confirm('当前草稿会保留在本地列表。确定开始一个新空间吗？')
    )
      return;
    loadScene(createDefaultScene());
    showNotice('已创建本地副本。首次保存后，可在当前浏览器中继续打开。');
  });
  for (const [selector, property, convert] of [
    ['#sky-preset', 'skyPreset', (v) => v],
    ['#time-of-day', 'timeOfDay', Number],
    ['#sun-intensity', 'sunIntensity', Number],
    ['#ambient-intensity', 'ambientIntensity', Number],
  ])
    $(selector).addEventListener('change', (event) =>
      apply([{ op: 'set_environment', patch: { [property]: convert(event.target.value) } }]),
    );
  $('#time-of-day').addEventListener('input', (event) => {
    $('#time-label').textContent =
      `${Math.floor(Number(event.target.value))}:${String(Math.round((Number(event.target.value) % 1) * 60)).padStart(2, '0')}`;
  });
  $('#doors-open').addEventListener('change', (event) =>
    apply([
      { op: 'set_environment', patch: { doorState: event.target.checked ? 'open' : 'closed' } },
    ]),
  );
  $('#landscape-visible').addEventListener('change', (event) =>
    apply([{ op: 'set_environment', patch: { landscapeVisible: event.target.checked } }]),
  );
  for (const [selector, targetId] of [
    ['#frame-material', 'pavilion.frame'],
    ['#roof-material', 'pavilion.roof'],
    ['#glass-material', 'pavilion.glass'],
  ]) {
    $(selector).addEventListener('change', (event) => {
      if (event.target.value)
        apply([
          {
            op: 'set_material',
            target: { kind: 'template', targetId, materialSlot: 'surface' },
            materialId: event.target.value,
          },
        ]);
      else
        edit(() =>
          history.replace({
            ...history.scene,
            templateOverrides: history.scene.templateOverrides.filter(
              (item) => item.targetId !== targetId,
            ),
          }),
        );
    });
  }
  for (const button of document.querySelectorAll('[data-add]'))
    button.addEventListener('click', () => {
      const assetId = button.dataset.add;
      const id = `obj_${crypto.randomUUID()}`;
      const index = history.scene.objects.length;
      if (
        apply([
          {
            op: 'add_object',
            id,
            assetId,
            name: `${assetLabels[assetId]} ${index + 1}`,
            materialId: ASSETS[assetId].materialIds[0],
            transform: {
              position: [5 + (index % 8) * 2, 0, 8 + Math.floor(index / 8) * 2],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          },
        ])
      )
        selectObject(id);
    });
  $('#object-list').addEventListener('change', (event) => selectObject(event.target.value));
  $('#object-name').addEventListener('change', (event) =>
    edit(() =>
      history.replace({
        ...history.scene,
        objects: history.scene.objects.map((object) =>
          object.id === selectedId ? { ...object, name: event.target.value } : object,
        ),
      }),
    ),
  );
  $('#object-material').addEventListener('change', (event) =>
    apply([
      {
        op: 'set_material',
        target: { kind: 'object', objectId: selectedId },
        materialId: event.target.value,
      },
    ]),
  );
  $('#remove-object').addEventListener('click', () => {
    if (apply([{ op: 'remove_object', objectId: selectedId }])) selectObject(null);
  });
  for (const input of document.querySelectorAll('[data-vector]'))
    input.addEventListener('change', () => {
      const object = history.scene.objects.find((item) => item.id === selectedId);
      if (!object) return;
      const transform = structuredClone(object.transform);
      const value = Number(input.value);
      transform[input.dataset.vector][Number(input.dataset.axis)] =
        input.dataset.vector === 'rotation' ? (value * Math.PI) / 180 : value;
      apply([{ op: 'move_object', objectId: selectedId, transform }]);
    });
  for (const mode of ['orbit', 'move'])
    $(`#${mode}-mode`).addEventListener('click', () => {
      renderer?.setTransformMode(mode);
      $('#orbit-mode').setAttribute('aria-pressed', String(mode === 'orbit'));
      $('#move-mode').setAttribute('aria-pressed', String(mode === 'move'));
    });
  $('#capture-camera').addEventListener('click', () => {
    if (renderer) apply([{ op: 'set_camera', camera: renderer.getCamera() }]);
  });
  $('#export-scene').addEventListener('click', exportScene);
  $('#import-scene').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 256 * 1024) throw new Error('文件太大，请选择不超过 256 KB 的空间备份。');
      const scene = validateSceneDocument(JSON.parse(await file.text()));
      if (!confirm('将导入为一个新副本，现有草稿保留。继续吗？')) return;
      loadScene(scene);
      showNotice('已导入为新副本，原来的空间和草稿仍然保留。', 'success');
    } catch (error) {
      showNotice(
        error instanceof SyntaxError || error instanceof TypeError
          ? '这份文件无法导入。请选择从织界导出的空间备份，现有草稿已保留。'
          : describeError(error),
        'error',
      );
    } finally {
      event.target.value = '';
    }
  });
  $('#open-library').addEventListener('click', openLibrary);
  for (const button of document.querySelectorAll('[data-close]'))
    button.addEventListener('click', () => $(`#${button.dataset.close}`).close());
  $('#privacy-details').addEventListener('click', (event) => {
    event.preventDefault();
    $('#privacy-dialog').showModal();
  });
  const isMobileEditor = () =>
    matchMedia('(max-width: 800px), (max-height: 500px) and (pointer: coarse)').matches;
  const setEditorPanel = (panel, { focus = false } = {}) => {
    $('#workspace').dataset.panel = panel;
    for (const button of document.querySelectorAll('.mobile-switch [data-panel]'))
      button.setAttribute('aria-pressed', String(button.dataset.panel === panel));
    if (!focus || !isMobileEditor()) return;
    const target =
      panel === 'properties'
        ? $('#properties-panel h1')
        : panel === 'assistant'
          ? $('#assistant-panel h2')
          : $('.mobile-switch [data-panel="canvas"]');
    requestAnimationFrame(() => target.focus({ preventScroll: true }));
  };
  for (const button of document.querySelectorAll('.mobile-switch [data-panel]'))
    button.addEventListener('click', () => setEditorPanel(button.dataset.panel, { focus: true }));
  for (const [selector, destination] of [
    ['#close-properties', 'canvas'],
    ['#close-assistant', 'canvas'],
  ])
    $(selector).addEventListener('click', () => {
      setEditorPanel(destination);
      $('.mobile-switch [data-panel="canvas"]').focus({ preventScroll: true });
    });
  document.addEventListener('keydown', (event) => {
    if (
      event.key !== 'Escape' ||
      !isMobileEditor() ||
      $('#workspace').dataset.panel === 'canvas' ||
      document.querySelector('dialog[open]')
    )
      return;
    event.preventDefault();
    setEditorPanel('canvas');
    $('.mobile-switch [data-panel="canvas"]').focus({ preventScroll: true });
  });
  const visualViewport = window.visualViewport;
  let keyboardFrame = 0;
  let visualViewportListenersAttached = false;
  const syncVisualViewport = () => {
    if (keyboardFrame) cancelAnimationFrame(keyboardFrame);
    keyboardFrame = requestAnimationFrame(() => {
      keyboardFrame = 0;
      if (visualViewport) {
        document.documentElement.style.setProperty(
          '--editor-viewport-height',
          `${Math.round(visualViewport.height)}px`,
        );
        document.documentElement.style.setProperty(
          '--editor-viewport-offset',
          `${Math.max(0, Math.round(visualViewport.offsetTop))}px`,
        );
      } else {
        document.documentElement.style.setProperty('--editor-viewport-height', `${innerHeight}px`);
      }
      renderer?.refreshSize?.();
    });
  };
  const attachVisualViewportListeners = () => {
    if (visualViewportListenersAttached) return;
    visualViewport?.addEventListener('resize', syncVisualViewport);
    visualViewport?.addEventListener('scroll', syncVisualViewport);
    window.addEventListener('resize', syncVisualViewport);
    visualViewportListenersAttached = true;
  };
  const detachVisualViewportListeners = () => {
    if (!visualViewportListenersAttached) return;
    visualViewport?.removeEventListener('resize', syncVisualViewport);
    visualViewport?.removeEventListener('scroll', syncVisualViewport);
    window.removeEventListener('resize', syncVisualViewport);
    visualViewportListenersAttached = false;
  };
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    detachVisualViewportListeners();
    if (keyboardFrame) cancelAnimationFrame(keyboardFrame);
    keyboardFrame = 0;
    document.documentElement.style.removeProperty('--editor-viewport-height');
    document.documentElement.style.removeProperty('--editor-viewport-offset');
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    attachVisualViewportListeners();
    syncVisualViewport();
  });
  attachVisualViewportListeners();
  syncVisualViewport();
  for (const button of document.querySelectorAll('[data-prompt]'))
    button.addEventListener('click', () => {
      if ($('#agent-prompt').disabled) {
        showNotice($('#agent-status').textContent);
        return;
      }
      $('#agent-prompt').value = button.dataset.prompt;
      $('#agent-prompt').focus();
    });
  $('#agent-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const prompt = $('#agent-prompt').value.trim();
    if (prompt) {
      $('#agent-prompt').value = '';
      runTurn(prompt);
    }
  });
  $('#agent-stop').addEventListener('click', stopTurn);
  $('#share-scene').addEventListener('click', () => {
    share = null;
    $('#share-result').hidden = true;
    $('#copy-share').hidden = true;
    $('#revoke-share').hidden = true;
    $('#confirm-share').hidden = false;
    $('#share-message').textContent = '';
    $('#share-dialog').showModal();
  });
  $('#confirm-share').addEventListener('click', async () => {
    const targetGeneration = loadGeneration;
    const targetSpace = spaceId;
    const targetRevision = savedRevision;
    $('#confirm-share').disabled = true;
    try {
      const createdShare = await requestJSON(`/api/v1/spaces/${targetSpace}/shares`, {
        method: 'POST',
        body: { revisionId: targetRevision, shareAttemptId: crypto.randomUUID() },
      });
      if (
        loadGeneration !== targetGeneration ||
        spaceId !== targetSpace ||
        savedRevision !== targetRevision
      )
        return;
      share = { ...createdShare, spaceId: targetSpace, revisionId: targetRevision };
      // Construct a same-origin viewer URL; a server-provided arbitrary URL is not trusted.
      const url = new URL('./create.html', location.href);
      url.searchParams.set('share', share.shareId);
      $('#share-url').value = url.href;
      $('#share-result').hidden = false;
      $('#copy-share').hidden = false;
      $('#revoke-share').hidden = false;
      $('#confirm-share').hidden = true;
      $('#share-message').textContent = '分享链接已创建，复制链接即可邀请别人来看看。';
    } catch (error) {
      const message = describeError(error);
      if (loadGeneration === targetGeneration && spaceId === targetSpace)
        $('#share-message').textContent = message;
    } finally {
      if (loadGeneration === targetGeneration && spaceId === targetSpace)
        $('#confirm-share').disabled = false;
    }
  });
  $('#copy-share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#share-url').value);
      $('#share-message').textContent = '链接已复制。';
    } catch {
      $('#share-url').select();
      $('#share-message').textContent = '请手动复制上面的链接。';
    }
  });
  $('#revoke-share').addEventListener('click', async () => {
    if (!share || !confirm('撤销后此链接不可再访问，但无法收回他人已复制的内容。继续吗？')) return;
    const targetGeneration = loadGeneration;
    const targetShare = share;
    const targetSpace = targetShare.spaceId || spaceId;
    try {
      await requestJSON(`/api/v1/spaces/${targetSpace}/shares/${targetShare.shareId}`, {
        method: 'DELETE',
        body: {},
      });
      if (loadGeneration === targetGeneration && share === targetShare) {
        $('#share-message').textContent = '这份分享已撤销。';
        $('#revoke-share').hidden = true;
        $('#copy-share').hidden = true;
      }
    } catch (error) {
      const message = describeError(error);
      if (loadGeneration === targetGeneration && share === targetShare)
        $('#share-message').textContent = message;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      readOnly ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) ||
      !(event.metaKey || event.ctrlKey) ||
      event.key.toLowerCase() !== 'z'
    )
      return;
    event.preventDefault();
    edit(() => (event.shiftKey ? history.redo() : history.undo()), { preserveCamera: false });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persistDraft();
  });
}

async function initialize() {
  for (const [selector, targetId] of [
    ['#frame-material', 'pavilion.frame'],
    ['#roof-material', 'pavilion.roof'],
    ['#glass-material', 'pavilion.glass'],
  ]) {
    $(selector).replaceChildren(
      new Option('原有颜色', ''),
      ...TEMPLATE_TARGETS[targetId].materialIds.map((id) => new Option(MATERIALS[id].label, id)),
    );
  }
  bindEvents();
  if (readOnly) {
    $('#scene-title').readOnly = true;
    try {
      const shareId = new URLSearchParams(location.search).get('share');
      if (!/^[a-zA-Z0-9_-]{8,180}$/.test(shareId)) throw new Error('分享链接无效。');
      const shared = await requestJSON(`/api/v1/public/spaces/${shareId}`);
      history = createHistory(validateSceneDocument(shared.scene || shared));
      savedJSON = JSON.stringify(history.scene);
    } catch (error) {
      $('#renderer-loading').textContent =
        error.status === 410 ? '这份分享已被撤销。' : '这份分享无法打开，可能已失效。';
      showNotice(describeError(error), 'error');
      return;
    }
  } else {
    try {
      draftStore = await createDraftStore();
      let claimedTabDraftId = null;
      let forkedBecauseRecordWasOpen = false;
      if (tabDraftRecordId) {
        draftRecordId = tabDraftRecordId;
        draftKey = `draft:${draftRecordId}`;
        if (await claimDraftLease(tabDraftRecordId)) claimedTabDraftId = tabDraftRecordId;
        else {
          forkedBecauseRecordWasOpen = draftLeaseAvailable;
          startIndependentDraftRecord();
        }
      }
      const drafts = (await draftStore.list('draft:'))
        .filter(({ value }) => value?.kind === 'loom-draft' && value.scene)
        .sort((left, right) =>
          String(right.value.updatedAt).localeCompare(String(left.value.updatedAt)),
        );
      const pointerKey = claimedTabDraftId ? `draft:${claimedTabDraftId}` : null;
      const selectedEntry =
        (pointerKey && drafts.find((entry) => entry.key === pointerKey)) || drafts[0];
      const selectedIsTabDraft = Boolean(selectedEntry && selectedEntry.key === pointerKey);
      if (selectedEntry) {
        const draft = selectedEntry.value;
        if (selectedIsTabDraft) {
          draftRecordId = selectedEntry.key.slice('draft:'.length);
          draftKey = selectedEntry.key;
          rememberDraftRecord();
        } else if (!forkedBecauseRecordWasOpen) {
          startIndependentDraftRecord();
        }
        history = createHistory(validateSceneDocument(draft.scene));
        if (draft.history) {
          try {
            history.restore(draft.history);
          } catch {
            /* Keep the separately validated scene. */
          }
        }
        spaceId = draft.spaceId;
        savedRevision = draft.savedRevision;
        savedJSON = draft.savedJSON;
        const restoredSave = recoverPendingSave(draft.pendingSave);
        pendingSave =
          restoredSave?.sceneJSON === JSON.stringify(history.scene) &&
          restoredSave.parentRevisionId === savedRevision
            ? restoredSave
            : null;
        pendingAck = recoverPendingAck(draft.pendingAck);
        if (pendingAck?.spaceId !== draft.spaceId) pendingAck = null;
        recoveredTurn = recoverPendingTurn(draft.pendingTurn, draft.spaceId);
        if (pendingAck) updatePendingAckRetryButton();
        if (recoveredTurn) updateRecoveredTurnControls();
        if (!selectedIsTabDraft) {
          showNotice(
            !draftLeaseAvailable
              ? '草稿已另存为新副本。这个浏览器无法区分重复打开的页面，再次打开时可能生成其他副本。'
              : forkedBecauseRecordWasOpen
                ? '这份草稿已在另一个页面打开，这里为你保留了一份独立副本。'
                : tabStorageAvailable
                  ? '已打开最近草稿的独立副本。其他草稿和已保存的空间，可在“我的空间”中打开。'
                  : '已打开最近的草稿副本。若不是你要的内容，可在“我的空间”选择其他草稿。',
          );
        } else if (pendingAck) {
          showNotice('草稿已恢复；有一项修改已应用但尚未确认，可在对话区安全重试确认。');
        } else if (recoveredTurn) {
          showNotice('草稿已恢复。上次的助手任务还没有确认结果，不会自动重新发送。');
        } else {
          showNotice('已恢复这个页面的草稿。其他草稿和已保存的空间，可在“我的空间”中打开。');
        }
      } else {
        if (!draftLease) void claimDraftLease(draftRecordId);
        rememberDraftRecord();
        if (!tabStorageAvailable)
          showNotice('可以继续编辑，草稿会保存在这个浏览器中。已有草稿可在“我的空间”中打开。');
      }
    } catch {
      localFailure = true;
      showNotice('本地存储不可用。你仍可编辑，但刷新可能丢失内容，请及时导出备份。', 'error');
    }
    establishSession()
      .then(async (result) => {
        session = result;
        const targetGeneration = loadGeneration;
        const targetSpace = spaceId;
        const targetRevision = savedRevision;
        if (targetRevision) {
          try {
            await requestJSON(`/api/v1/spaces/${targetSpace}/revisions/${targetRevision}`);
          } catch (error) {
            if (
              error.status === 404 &&
              loadGeneration === targetGeneration &&
              spaceId === targetSpace &&
              savedRevision === targetRevision
            ) {
              loadGeneration++;
              spaceId = crypto.randomUUID();
              savedRevision = null;
              savedJSON = null;
              pendingSave = null;
              conversationId = null;
              pendingAck = null;
              recoveredTurn = null;
              updatePendingAckRetryButton();
              updateRecoveredTurnControls();
              showNotice(
                '这个浏览器已无法打开原来保存的空间。内容已保留为新副本，可以重新保存；原空间的访问权限无法恢复。',
              );
            }
          }
        }
        refreshStatus();
        persistDraft();
      })
      .catch((error) => {
        session = null;
        refreshStatus();
        showNotice(describeError(error));
      });
  }
  refreshControls();
  try {
    renderer = await createSpaceRenderer({
      container: $('#viewport'),
      readOnly,
      onSelect: selectObject,
      onTransform: ({ id, transform }) => apply([{ op: 'move_object', objectId: id, transform }]),
      onStatus: ({ mode, message }) => {
        $('#render-status').textContent =
          message || (mode === 'svg' ? '简化画面 · 部分细节与阴影不显示' : '空间画面');
      },
    });
    renderDocument({ preserveCamera: false });
    $('#renderer-loading').hidden = true;
  } catch {
    $('#renderer-loading').textContent =
      '空间画面暂时无法打开。仍可在布置面板中调整物件和导出备份。';
    showNotice('这台设备暂时无法显示空间画面，已有内容未被更改。', 'error');
  }
  persistDraft();
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) {
      renderer?.dispose();
      releaseDraftLease();
    }
  });
}

initialize().catch(() => {
  $('#renderer-loading').textContent = '编辑器未能打开，请刷新重试。';
  showNotice('空间暂时无法打开，已有草稿和云端内容仍然保留。', 'error');
});
