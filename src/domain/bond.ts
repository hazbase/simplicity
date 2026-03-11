import path from "node:path";
import type { SimplicityClient } from "../client/SimplicityClient";
import {
  BondDefinition,
  BondIssuanceState,
  SimplicityArtifact,
} from "../core/types";
import {
  validateBondCrossChecks,
  validateBondDefinition,
  validateBondIssuanceState,
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
