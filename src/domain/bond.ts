import path from "node:path";
import type { SimplicityClient } from "../client/SimplicityClient";
import {
  BondDefinition,
  BondIssuanceState,
  BondSettlementDescriptor,
  SimplicityArtifact,
} from "../core/types";
import { sha256HexUtf8 } from "../core/summary";
import {
  summarizeBondSettlementDescriptor,
  validateBondSettlementDescriptor,
  validateBondSettlementMatchesExpected,
} from "./bondSettlementValidation";
import {
  validateBondCrossChecks,
  validateBondDefinition,
  validateBondIssuanceState,
  validateBondStateTransition,
  buildRedeemedBondIssuanceState,
  summarizeBondIssuanceState,
} from "./bondValidation";

function resolveValueOrPath<T>(options: {
  pathValue?: string;
  objectValue?: T;
  envName?: string;
}): { jsonPath?: string; value?: T } {
  if (options.pathValue) return { jsonPath: options.pathValue };
  if (options.objectValue !== undefined) return { value: options.objectValue };
  return {};
}

export async function defineBond(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    issuancePath?: string;
    issuanceValue?: BondIssuanceState;
    simfPath?: string;
    artifactPath?: string;
  }
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const issuanceSource = resolveValueOrPath({
    pathValue: input.issuancePath,
    objectValue: input.issuanceValue,
  });
  const initialDefinitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const definition = validateBondDefinition(JSON.parse(initialDefinitionDescriptor.canonicalJson));
  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: definition.bondId,
    ...(definitionSource.jsonPath ? { jsonPath: definitionSource.jsonPath } : { value: definition }),
  });
  const initialStateDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.issuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...issuanceSource,
  });
  const issuance = validateBondIssuanceState(JSON.parse(initialStateDescriptor.canonicalJson));
  const stateDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: issuance.issuanceId,
    ...(issuanceSource.jsonPath ? { jsonPath: issuanceSource.jsonPath } : { value: issuance }),
  });
  validateBondCrossChecks(definition, issuance);
  const simfPath =
    input.simfPath ?? path.resolve(process.cwd(), "docs/definitions/bond-issuance-anchor.simf");
  return sdk.compileFromFile({
    simfPath,
    templateVars: {
      MIN_HEIGHT: definition.maturityDate,
      SIGNER_XONLY: definition.controllerXonly,
    },
    definition: {
      type: definitionDescriptor.definitionType,
      id: definitionDescriptor.definitionId,
      schemaVersion: definitionDescriptor.schemaVersion,
      ...(definitionDescriptor.sourcePath ? { jsonPath: definitionDescriptor.sourcePath } : { value: definition }),
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: stateDescriptor.stateType,
      id: stateDescriptor.stateId,
      schemaVersion: stateDescriptor.schemaVersion,
      ...(stateDescriptor.sourcePath ? { jsonPath: stateDescriptor.sourcePath } : { value: issuance }),
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

export async function verifyBond(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    issuancePath?: string;
    issuanceValue?: BondIssuanceState;
  }
) {
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  if (!artifact) {
    throw new Error("artifactPath or artifact is required");
  }
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const issuanceSource = resolveValueOrPath({
    pathValue: input.issuancePath,
    objectValue: input.issuanceValue,
  });
  const definition = await sdk.verifyDefinitionAgainstArtifact({
    artifact,
    type: "bond",
    id: artifact.definition?.definitionId,
    ...definitionSource,
  });
  const issuance = await sdk.verifyStateAgainstArtifact({
    artifact,
    type: "bond-issuance",
    id: artifact.state?.stateId,
    ...issuanceSource,
  });
  const definitionValue = validateBondDefinition(JSON.parse(definition.definition.canonicalJson));
  const issuanceValue = validateBondIssuanceState(JSON.parse(issuance.state.canonicalJson));
  const crossChecks = validateBondCrossChecks(definitionValue, issuanceValue);
  return {
    artifact,
    definition,
    issuance,
    crossChecks,
  };
}

export async function loadBond(
  sdk: SimplicityClient,
  input: {
    artifactPath: string;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    issuancePath?: string;
    issuanceValue?: BondIssuanceState;
  }
) {
  const compiled = await sdk.loadArtifact(input.artifactPath);
  const verification = await verifyBond(sdk, {
    artifact: compiled.artifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    issuancePath: input.issuancePath,
    issuanceValue: input.issuanceValue,
  });
  return {
    artifact: compiled.artifact,
    definition: verification.definition,
    issuance: verification.issuance,
    crossChecks: verification.crossChecks,
    trust: {
      definitionTrust: verification.definition.trust,
      issuanceTrust: verification.issuance.trust,
    },
  };
}

export async function buildBondPayload(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    issuancePath?: string;
    issuanceValue?: BondIssuanceState;
  }
) {
  const verification = await verifyBond(sdk, input);
  const definitionValue = validateBondDefinition(JSON.parse(verification.definition.definition.canonicalJson));
  const issuanceValue = validateBondIssuanceState(JSON.parse(verification.issuance.state.canonicalJson));
  const issuanceSummary = summarizeBondIssuanceState(issuanceValue);
  return {
    artifact: verification.artifact,
    payload: {
      bondId: definitionValue.bondId,
      issuanceId: issuanceValue.issuanceId,
      definitionHash: verification.definition.definition.hash,
      issuanceStateHash: issuanceSummary.hash,
      previousStateHash: issuanceValue.previousStateHash ?? null,
      contractAddress: verification.artifact.compiled.contractAddress,
      cmr: verification.artifact.compiled.cmr,
      anchorModes: {
        definition: verification.artifact.definition?.anchorMode ?? "none",
        state: verification.artifact.state?.anchorMode ?? "none",
      },
      status: issuanceValue.status,
      lastTransition: issuanceValue.lastTransition
        ? {
            type: issuanceValue.lastTransition.type,
            amount: issuanceValue.lastTransition.amount,
            at: issuanceValue.lastTransition.at,
          }
        : null,
      principal: {
        issued: issuanceValue.issuedPrincipal,
        outstanding: issuanceValue.outstandingPrincipal,
        redeemed: issuanceValue.redeemedPrincipal,
      },
      crossChecks: verification.crossChecks,
    },
    trust: {
      definitionTrust: verification.definition.trust,
      issuanceTrust: verification.issuance.trust,
    },
  };
}

function detectPreviousStateAnchor(simfSource: string): {
  sourceVerified: boolean;
  reason?: string;
} {
  const source = simfSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (!source.includes("{{PREVIOUS_STATE_HASH}}")) {
    return { sourceVerified: false, reason: "PREVIOUS_STATE_HASH placeholder is missing" };
  }
  if (!source.includes("fn require_previous_state_anchor()")) {
    return { sourceVerified: false, reason: "require_previous_state_anchor helper is missing" };
  }
  if (!source.includes("let previous_state_hash: u256 = 0x{{PREVIOUS_STATE_HASH}};")) {
    return { sourceVerified: false, reason: "previous_state_hash assignment is missing" };
  }
  if (!source.includes("require_previous_state_anchor();")) {
    return { sourceVerified: false, reason: "require_previous_state_anchor() is not called from main" };
  }
  if (!source.includes("require_distinct_transition_state();")) {
    return { sourceVerified: false, reason: "require_distinct_transition_state() is not called from main" };
  }
  return { sourceVerified: true };
}

function toUint256Hex(value: number): string {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`Expected a non-negative integer for uint256 conversion, got: ${value}`);
  }
  return value.toString(16).padStart(64, "0");
}

function toUint32Hex(value: number): string {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value) || value > 0xffffffff) {
    throw new Error(`Expected a u32-compatible non-negative integer, got: ${value}`);
  }
  return value.toString(16).padStart(8, "0");
}

function hashContractAddressToUint256Hex(address: string): string {
  return sha256HexUtf8(address);
}

function bondStatusToCode(status: BondIssuanceState["status"]): number {
  switch (status) {
    case "ISSUED":
      return 1;
    case "PARTIALLY_REDEEMED":
      return 2;
    case "REDEEMED":
      return 3;
    default: {
      const exhaustiveCheck: never = status;
      throw new Error(`Unsupported bond status: ${exhaustiveCheck}`);
    }
  }
}

export async function redeemBond(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    amount: number;
    redeemedAt: string;
    simfPath?: string;
    artifactPath?: string;
  }
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const previousSource = resolveValueOrPath({
    pathValue: input.previousIssuancePath,
    objectValue: input.previousIssuanceValue,
  });

  const initialDefinitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const definition = validateBondDefinition(JSON.parse(initialDefinitionDescriptor.canonicalJson));
  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: definition.bondId,
    ...(definitionSource.jsonPath ? { jsonPath: definitionSource.jsonPath } : { value: definition }),
  });

  const initialPreviousStateDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.previousIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...previousSource,
  });
  const previousIssuance = validateBondIssuanceState(JSON.parse(initialPreviousStateDescriptor.canonicalJson));
  validateBondCrossChecks(definition, previousIssuance);

  const nextIssuance = buildRedeemedBondIssuanceState({
    previous: previousIssuance,
    amount: input.amount,
    redeemedAt: input.redeemedAt,
  });
  validateBondStateTransition(previousIssuance, nextIssuance);

  const stateDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: nextIssuance.issuanceId,
    value: nextIssuance,
  });

  const simfPath =
    input.simfPath ?? path.resolve(process.cwd(), "docs/definitions/bond-issuance-anchor.simf");
  return sdk.compileFromFile({
    simfPath,
    templateVars: {
      MIN_HEIGHT: definition.maturityDate,
      SIGNER_XONLY: definition.controllerXonly,
    },
    definition: {
      type: definitionDescriptor.definitionType,
      id: definitionDescriptor.definitionId,
      schemaVersion: definitionDescriptor.schemaVersion,
      ...(definitionDescriptor.sourcePath ? { jsonPath: definitionDescriptor.sourcePath } : { value: definition }),
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: stateDescriptor.stateType,
      id: stateDescriptor.stateId,
      schemaVersion: stateDescriptor.schemaVersion,
      value: nextIssuance,
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

export async function buildBondTransitionPayload(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
  }
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const previousSource = resolveValueOrPath({
    pathValue: input.previousIssuancePath,
    objectValue: input.previousIssuanceValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });

  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const previousDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.previousIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...previousSource,
  });
  const nextDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.nextIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...nextSource,
  });

  const definition = validateBondDefinition(JSON.parse(definitionDescriptor.canonicalJson));
  const previous = validateBondIssuanceState(JSON.parse(previousDescriptor.canonicalJson));
  const next = validateBondIssuanceState(JSON.parse(nextDescriptor.canonicalJson));
  const previousCrossChecks = validateBondCrossChecks(definition, previous);
  const nextCrossChecks = validateBondCrossChecks(definition, next);
  const transition = validateBondStateTransition(previous, next);

  return {
    definition,
    previous,
    next,
    payload: {
      bondId: definition.bondId,
      issuanceId: previous.issuanceId,
      definitionHash: definitionDescriptor.hash,
      previousStateHash: previousDescriptor.hash,
      nextStateHash: nextDescriptor.hash,
      previousStatus: previous.status,
      nextStatus: next.status,
      previousStatusCode: bondStatusToCode(previous.status),
      nextStatusCode: bondStatusToCode(next.status),
      transitionKind: next.lastTransition?.type ?? null,
      redeemAmount: next.lastTransition?.type === "REDEEM" ? next.lastTransition.amount : null,
      transitionAt: next.lastTransition?.at ?? null,
      principal: {
        issued: previous.issuedPrincipal,
        previousOutstanding: previous.outstandingPrincipal,
        nextOutstanding: next.outstandingPrincipal,
        previousRedeemed: previous.redeemedPrincipal,
        nextRedeemed: next.redeemedPrincipal,
        outstandingDelta: previous.outstandingPrincipal - next.outstandingPrincipal,
        redeemedDelta: next.redeemedPrincipal - previous.redeemedPrincipal,
      },
      crossChecks: {
        previous: previousCrossChecks,
        next: nextCrossChecks,
        transition,
      },
    },
  };
}

export async function buildBondSettlementDescriptor(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat: number;
    maxFeeSat?: number;
  }
) {
  const transition = await buildBondTransitionPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
  });
  const nextStateCompiled = await defineBond(sdk, {
    definitionValue: transition.definition,
    issuanceValue: transition.next,
    simfPath: input.nextStateSimfPath,
  });
  const nextContractAddress = nextStateCompiled.deployment().contractAddress;
  const descriptor = validateBondSettlementDescriptor({
    settlementId: `${transition.previous.issuanceId}-SETTLEMENT-${transition.payload.nextStatus}`,
    bondId: transition.definition.bondId,
    issuanceId: transition.previous.issuanceId,
    definitionHash: transition.payload.definitionHash,
    previousStateHash: transition.payload.previousStateHash,
    nextStateHash: transition.payload.nextStateHash,
    previousStatus: transition.payload.previousStatus,
    nextStatus: transition.payload.nextStatus,
    transitionKind: "REDEEM",
    redeemAmount: transition.payload.redeemAmount ?? 0,
    transitionAt: transition.payload.transitionAt ?? transition.next.lastTransition?.at ?? transition.next.issuedAt,
    assetId: transition.definition.currencyAssetId,
    nextContractAddress,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat ?? 100,
    principal: {
      issued: transition.payload.principal.issued,
      previousOutstanding: transition.payload.principal.previousOutstanding,
      nextOutstanding: transition.payload.principal.nextOutstanding,
      previousRedeemed: transition.payload.principal.previousRedeemed,
      nextRedeemed: transition.payload.principal.nextRedeemed,
    },
  } satisfies BondSettlementDescriptor);
  const summary = summarizeBondSettlementDescriptor(descriptor);
  return {
    definition: transition.definition,
    previous: transition.previous,
    next: transition.next,
    transition: transition.payload.crossChecks.transition,
    nextContractAddress,
    descriptor,
    canonicalJson: summary.canonicalJson,
    hash: summary.hash,
  };
}

export async function verifyBondSettlementDescriptor(
  sdk: SimplicityClient,
  input: {
    descriptorPath?: string;
    descriptorValue?: BondSettlementDescriptor;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
  }
) {
  const descriptorSource = resolveValueOrPath({
    pathValue: input.descriptorPath,
    objectValue: input.descriptorValue,
  });
  const descriptor = validateBondSettlementDescriptor(
    descriptorSource.jsonPath
      ? JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(descriptorSource.jsonPath!, "utf8")))
      : descriptorSource.value
  );
  const expected = await buildBondSettlementDescriptor(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? descriptor.nextAmountSat,
    maxFeeSat: input.maxFeeSat ?? descriptor.maxFeeSat,
  });
  const actualSummary = summarizeBondSettlementDescriptor(descriptor);
  const matches = validateBondSettlementMatchesExpected(descriptor, expected.descriptor);
  return {
    ok: actualSummary.hash === expected.hash,
    reason: actualSummary.hash === expected.hash ? undefined : "Bond settlement descriptor hash mismatch",
    descriptor,
    expected: expected.descriptor,
    hash: actualSummary.hash,
    expectedHash: expected.hash,
    matches,
  };
}

export async function buildBondSettlementPayload(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat: number;
    maxFeeSat?: number;
  }
) {
  const result = await buildBondSettlementDescriptor(sdk, input);
  return {
    descriptor: result.descriptor,
    descriptorHash: result.hash,
    previousStateHash: result.descriptor.previousStateHash,
    nextStateHash: result.descriptor.nextStateHash,
    nextContractAddress: result.descriptor.nextContractAddress,
    nextAmountSat: result.descriptor.nextAmountSat,
    maxFeeSat: result.descriptor.maxFeeSat,
  };
}

export async function compileBondTransition(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    simfPath?: string;
    artifactPath?: string;
  }
) {
  const transitionPayload = await buildBondTransitionPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
  });

  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });
  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: transitionPayload.definition.bondId,
    ...definitionSource,
  });
  const nextDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: transitionPayload.next.issuanceId,
    ...nextSource,
  });

  const simfPath =
    input.simfPath ?? path.resolve(process.cwd(), "docs/definitions/bond-redemption-transition.simf");
  const rawSource = await import("node:fs/promises").then((fs) => fs.readFile(simfPath, "utf8"));
  const previousAnchor = detectPreviousStateAnchor(rawSource);
  if (!previousAnchor.sourceVerified) {
    throw new Error(`Transition contract source is missing required previous-state anchor pattern: ${previousAnchor.reason}`);
  }

  const compiled = await sdk.compileFromFile({
    simfPath,
    templateVars: {
      MIN_HEIGHT: transitionPayload.definition.maturityDate,
      SIGNER_XONLY: transitionPayload.definition.controllerXonly,
      PREVIOUS_STATE_HASH: transitionPayload.payload.previousStateHash,
    },
    definition: {
      type: definitionDescriptor.definitionType,
      id: definitionDescriptor.definitionId,
      schemaVersion: definitionDescriptor.schemaVersion,
      ...(definitionDescriptor.sourcePath ? { jsonPath: definitionDescriptor.sourcePath } : { value: transitionPayload.definition }),
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: nextDescriptor.stateType,
      id: nextDescriptor.stateId,
      schemaVersion: nextDescriptor.schemaVersion,
      ...(nextDescriptor.sourcePath ? { jsonPath: nextDescriptor.sourcePath } : { value: transitionPayload.next }),
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });

  return {
    compiled,
    previousHash: transitionPayload.payload.previousStateHash,
    nextHash: transitionPayload.payload.nextStateHash,
    transition: transitionPayload.payload.crossChecks.transition,
    payload: transitionPayload.payload,
  };
}

export async function verifyBondRedemptionMachineArtifact(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
  }
) {
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  if (!artifact) {
    throw new Error("artifactPath or artifact is required");
  }

  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });

  const definitionVerification = await sdk.verifyDefinitionAgainstArtifact({
    artifact,
    type: "bond",
    id: artifact.definition?.definitionId,
    ...definitionSource,
  });
  const nextStateVerification = await sdk.verifyStateAgainstArtifact({
    artifact,
    type: "bond-issuance",
    id: artifact.state?.stateId,
    ...nextSource,
  });

  const expected = await buildBondTransitionPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
  });

  const expectedNextCompiled = await defineBond(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: expected.definition,
    issuanceValue: expected.next,
    simfPath: input.nextStateSimfPath,
  });
  const expectedNextContractAddress = expectedNextCompiled.deployment().contractAddress;
  const expectedNextContractAddressHash = hashContractAddressToUint256Hex(expectedNextContractAddress);
  const expectedSettlement = await buildBondSettlementDescriptor(sdk, {
    definitionValue: expected.definition,
    previousIssuanceValue: expected.previous,
    nextIssuanceValue: expected.next,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? 1900,
    maxFeeSat: input.maxFeeSat ?? 100,
  });

  const templateVars = artifact.source.templateVars ?? {};
  const committed = {
    previousStateHash: String(templateVars.PREVIOUS_STATE_HASH ?? ""),
    redeemAmount256: String(templateVars.REDEEM_AMOUNT_256 ?? ""),
    transitionKind256: String(templateVars.TRANSITION_KIND_256 ?? ""),
    redeemAmount32: String(templateVars.REDEEM_AMOUNT_32 ?? ""),
    previousStatus32: String(templateVars.PREVIOUS_STATUS_32 ?? ""),
    nextStatus32: String(templateVars.NEXT_STATUS_32 ?? ""),
    previousOutstanding32: String(templateVars.PREVIOUS_OUTSTANDING_32 ?? ""),
    previousRedeemed32: String(templateVars.PREVIOUS_REDEEMED_32 ?? ""),
    nextOutstanding32: String(templateVars.NEXT_OUTSTANDING_32 ?? ""),
    nextRedeemed32: String(templateVars.NEXT_REDEEMED_32 ?? ""),
    nextContractAddressHash256: String(templateVars.NEXT_CONTRACT_ADDRESS_HASH_256 ?? ""),
    settlementDescriptorHash256: String(templateVars.SETTLEMENT_DESCRIPTOR_HASH ?? ""),
  };

  const checks = {
    previousStateHashCommitted: committed.previousStateHash === expected.payload.previousStateHash,
    redeemAmountCommitted:
      committed.redeemAmount256 === toUint256Hex(expected.payload.redeemAmount ?? 0)
      && committed.redeemAmount32 === toUint32Hex(expected.payload.redeemAmount ?? 0),
    transitionKindCommitted: committed.transitionKind256 === toUint256Hex(expected.payload.transitionKind === "REDEEM" ? 1 : 0),
    statusCodesCommitted:
      committed.previousStatus32 === toUint32Hex(expected.payload.previousStatusCode)
      && committed.nextStatus32 === toUint32Hex(expected.payload.nextStatusCode),
    principalArithmeticCommitted:
      committed.previousOutstanding32 === toUint32Hex(expected.payload.principal.previousOutstanding)
      && committed.previousRedeemed32 === toUint32Hex(expected.payload.principal.previousRedeemed)
      && committed.nextOutstanding32 === toUint32Hex(expected.payload.principal.nextOutstanding)
      && committed.nextRedeemed32 === toUint32Hex(expected.payload.principal.nextRedeemed),
    nextContractAddressCommitted: committed.nextContractAddressHash256 === expectedNextContractAddressHash,
    settlementDescriptorCommitted: committed.settlementDescriptorHash256 === expectedSettlement.hash,
  };
  const allChecks = Object.values(checks).every(Boolean);
  return {
    artifact,
    definition: definitionVerification,
    issuance: nextStateVerification,
    expectedPayload: {
      ...expected.payload,
      nextStateContractAddress: expectedNextContractAddress,
      nextStateContractAddressHash: expectedNextContractAddressHash,
    },
    expectedSettlementDescriptor: expectedSettlement.descriptor,
    expectedSettlementDescriptorHash: expectedSettlement.hash,
    expectedNextContractAddress,
    expectedNextContractAddressHash,
    committed,
    checks,
    verified:
      definitionVerification.ok
      && nextStateVerification.ok
      && definitionVerification.trust.onChainAnchorVerified
      && nextStateVerification.trust.onChainAnchorVerified
      && allChecks,
  };
}

export async function compileBondRedemptionMachine(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    simfPath?: string;
    artifactPath?: string;
  }
) {
  const transitionResult = await compileBondTransition(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
  });

  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });

  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: transitionResult.compiled.definition()?.definitionId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const nextDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: transitionResult.compiled.state()?.stateId ?? "BOND-2026-001-ISSUE-1",
    ...nextSource,
  });
  const definition = validateBondDefinition(JSON.parse(definitionDescriptor.canonicalJson));
  const next = validateBondIssuanceState(JSON.parse(nextDescriptor.canonicalJson));

  const nextStateCompiled = await defineBond(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: definition,
    issuanceValue: next,
    simfPath: input.nextStateSimfPath,
  });
  const nextStateContractAddress = nextStateCompiled.deployment().contractAddress;
  const nextStateContractAddressHash = hashContractAddressToUint256Hex(nextStateContractAddress);
  const settlementDescriptor = await buildBondSettlementDescriptor(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue ?? definition,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue ?? next,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? 1900,
    maxFeeSat: input.maxFeeSat ?? 100,
  });

  const simfPath =
    input.simfPath ?? path.resolve(process.cwd(), "docs/definitions/bond-redemption-state-machine.simf");

  const compiled = await sdk.compileFromFile({
    simfPath,
    templateVars: {
      MIN_HEIGHT: definition.maturityDate,
      SIGNER_XONLY: definition.controllerXonly,
      PREVIOUS_STATE_HASH: transitionResult.previousHash,
      REDEEM_AMOUNT_256: toUint256Hex(next.lastTransition?.amount ?? 0),
      TRANSITION_KIND_256: toUint256Hex(1),
      REDEEM_AMOUNT_32: toUint32Hex(next.lastTransition?.amount ?? 0),
      PREVIOUS_STATUS_32: toUint32Hex(bondStatusToCode(transitionResult.payload.previousStatus)),
      NEXT_STATUS_32: toUint32Hex(bondStatusToCode(transitionResult.payload.nextStatus)),
      PREVIOUS_OUTSTANDING_32: toUint32Hex(transitionResult.payload.principal.previousOutstanding),
      PREVIOUS_REDEEMED_32: toUint32Hex(transitionResult.payload.principal.previousRedeemed),
      NEXT_OUTSTANDING_32: toUint32Hex(transitionResult.payload.principal.nextOutstanding),
      NEXT_REDEEMED_32: toUint32Hex(transitionResult.payload.principal.nextRedeemed),
      NEXT_CONTRACT_ADDRESS_HASH_256: nextStateContractAddressHash,
      SETTLEMENT_DESCRIPTOR_HASH: settlementDescriptor.hash,
    },
    definition: {
      type: definitionDescriptor.definitionType,
      id: definitionDescriptor.definitionId,
      schemaVersion: definitionDescriptor.schemaVersion,
      ...(definitionDescriptor.sourcePath ? { jsonPath: definitionDescriptor.sourcePath } : { value: definition }),
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: nextDescriptor.stateType,
      id: nextDescriptor.stateId,
      schemaVersion: nextDescriptor.schemaVersion,
      ...(nextDescriptor.sourcePath ? { jsonPath: nextDescriptor.sourcePath } : { value: next }),
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });

  return {
    compiled,
    previousHash: transitionResult.previousHash,
    nextHash: transitionResult.nextHash,
    transition: transitionResult.transition,
    redeemAmount: next.lastTransition?.amount ?? 0,
    transitionKind: "REDEEM" as const,
    nextStateContractAddress,
    nextStateContractAddressHash,
    settlementDescriptor: settlementDescriptor.descriptor,
    settlementDescriptorHash: settlementDescriptor.hash,
    payload: {
      ...transitionResult.payload,
      transitionKind: "REDEEM" as const,
      redeemAmount: next.lastTransition?.amount ?? 0,
      previousStatusCode: bondStatusToCode(transitionResult.payload.previousStatus),
      nextStatusCode: bondStatusToCode(transitionResult.payload.nextStatus),
      contractAddress: compiled.artifact.compiled.contractAddress,
      cmr: compiled.artifact.compiled.cmr,
      anchorModes: {
        definition: compiled.artifact.definition?.anchorMode ?? "none",
        state: compiled.artifact.state?.anchorMode ?? "none",
      },
      nextStateContractAddress,
      nextStateContractAddressHash,
      settlementDescriptor: settlementDescriptor.descriptor,
      settlementDescriptorHash: settlementDescriptor.hash,
    },
  };
}

export async function buildBondRedemption(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    amount: number;
    redeemedAt: string;
  }
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const previousSource = resolveValueOrPath({
    pathValue: input.previousIssuancePath,
    objectValue: input.previousIssuanceValue,
  });

  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const previousDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.previousIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...previousSource,
  });
  const definition = validateBondDefinition(JSON.parse(definitionDescriptor.canonicalJson));
  const previous = validateBondIssuanceState(JSON.parse(previousDescriptor.canonicalJson));
  validateBondCrossChecks(definition, previous);
  const next = buildRedeemedBondIssuanceState({
    previous,
    amount: input.amount,
    redeemedAt: input.redeemedAt,
  });
  const transition = validateBondStateTransition(previous, next);
  return {
    definition,
    previous,
    next,
    previousHash: previousDescriptor.hash,
    nextHash: summarizeBondIssuanceState(next).hash,
    transition,
  };
}

export async function verifyBondTransition(
  sdk: SimplicityClient,
  input: {
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
  }
) {
  const previousSource = resolveValueOrPath({
    pathValue: input.previousIssuancePath,
    objectValue: input.previousIssuanceValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });
  const previousDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.previousIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...previousSource,
  });
  const nextDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.nextIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...nextSource,
  });
  const previous = validateBondIssuanceState(JSON.parse(previousDescriptor.canonicalJson));
  const next = validateBondIssuanceState(JSON.parse(nextDescriptor.canonicalJson));
  const transition = validateBondStateTransition(previous, next);
  return {
    previous,
    next,
    previousHash: previousDescriptor.hash,
    nextHash: nextDescriptor.hash,
    transition,
  };
}

export async function buildBondRolloverPlan(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
  }
) {
  const currentArtifact =
    input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new Error("currentArtifactPath or currentArtifact is required");
  }

  const currentVerification = await verifyBond(sdk, {
    artifact: currentArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    issuancePath: input.previousIssuancePath,
    issuanceValue: input.previousIssuanceValue,
  });

  const definitionValue = validateBondDefinition(JSON.parse(currentVerification.definition.definition.canonicalJson));
  const nextIssuanceSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });
  const nextInitialStateDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.nextIssuanceValue?.issuanceId ?? currentArtifact.state?.stateId ?? "BOND-2026-001-ISSUE-1",
    ...nextIssuanceSource,
  });
  const nextIssuance = validateBondIssuanceState(JSON.parse(nextInitialStateDescriptor.canonicalJson));
  validateBondCrossChecks(definitionValue, nextIssuance);

  const transitionPayload = await buildBondTransitionPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: currentVerification.issuance
      ? validateBondIssuanceState(JSON.parse(currentVerification.issuance.state.canonicalJson))
      : input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: nextIssuance,
  });

  const nextCompiled = await defineBond(sdk, {
    definitionPath: input.definitionPath,
    definitionValue,
    issuanceValue: nextIssuance,
    simfPath: input.nextSimfPath,
    artifactPath: input.nextArtifactPath,
  });

  return {
    currentArtifact,
    currentVerification,
    nextCompiled,
    nextContractAddress: nextCompiled.deployment().contractAddress,
    transitionPayload: transitionPayload.payload,
  };
}

export async function buildBondMachineRolloverPlan(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    machineSimfPath?: string;
    machineArtifactPath?: string;
  }
) {
  const currentArtifact =
    input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new Error("currentArtifactPath or currentArtifact is required");
  }

  const currentVerification = await verifyBond(sdk, {
    artifact: currentArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    issuancePath: input.previousIssuancePath,
    issuanceValue: input.previousIssuanceValue,
  });

  const machineCompiled = await compileBondRedemptionMachine(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    simfPath: input.machineSimfPath,
    artifactPath: input.machineArtifactPath,
  });

  const machineVerification = await verifyBondRedemptionMachineArtifact(sdk, {
    artifact: machineCompiled.compiled.artifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
  });

  return {
    currentArtifact,
    currentVerification,
    machineCompiled,
    machineVerification,
    nextContractAddress: machineCompiled.compiled.deployment().contractAddress,
    transitionPayload: machineCompiled.payload,
  };
}

export async function buildBondMachineSettlementPlan(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
  }
) {
  const currentMachineArtifact =
    input.currentMachineArtifact
    ?? (input.currentMachineArtifactPath ? (await sdk.loadArtifact(input.currentMachineArtifactPath)).artifact : undefined);
  if (!currentMachineArtifact) {
    throw new Error("currentMachineArtifactPath or currentMachineArtifact is required");
  }

  const machineVerification = await verifyBondRedemptionMachineArtifact(sdk, {
    artifact: currentMachineArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextSimfPath,
  });

  const definitionValue = validateBondDefinition(JSON.parse(machineVerification.definition.definition.canonicalJson));
  const nextStateValue = validateBondIssuanceState(JSON.parse(machineVerification.issuance.state.canonicalJson));

  const nextCompiled = await defineBond(sdk, {
    definitionPath: input.definitionPath,
    definitionValue,
    issuanceValue: nextStateValue,
    simfPath: input.nextSimfPath,
    artifactPath: input.nextArtifactPath,
  });

  return {
    currentMachineArtifact,
    machineVerification,
    nextCompiled,
    nextContractAddress: nextCompiled.deployment().contractAddress,
    transitionPayload: machineVerification.expectedPayload,
    nextContractAddressMatchesMachineCommitment:
      nextCompiled.deployment().contractAddress === machineVerification.expectedNextContractAddress,
  };
}

export async function inspectBondStateRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function inspectBondMachineRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondMachineRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function inspectBondMachineSettlement(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondMachineSettlementPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentMachineArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function executeBondStateRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}

export async function executeBondMachineRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondMachineRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}

export async function executeBondMachineSettlement(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondMachineSettlementPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentMachineArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}
