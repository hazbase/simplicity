import type {
  BondOutputBindingMode,
  DefinitionVerificationResult,
  DomainLineageTrust,
  LineageTrustBase,
  StateVerificationResult,
  VerificationTrustSummary,
} from "./types";

export function buildLineageTrustBase<LineageKind extends string>(
  input: LineageTrustBase<LineageKind>,
): LineageTrustBase<LineageKind> {
  return { ...input };
}

export function buildVerificationTrustSections<TDefinitionTrust, TStateTrust>(input: {
  definitionTrust?: TDefinitionTrust;
  stateTrust?: TStateTrust;
  requireArtifactTrust?: boolean;
  emptyDefinitionTrust: TDefinitionTrust;
  emptyStateTrust: TStateTrust;
}): {
  artifactTrust: {
    definition: TDefinitionTrust;
    state: TStateTrust;
  };
  stateTrust: TStateTrust;
} {
  void input.requireArtifactTrust;
  const definitionTrust = input.definitionTrust ?? input.emptyDefinitionTrust;
  const stateTrust = input.stateTrust ?? input.emptyStateTrust;

  return {
    artifactTrust: {
      definition: definitionTrust,
      state: stateTrust,
    },
    stateTrust,
  };
}

export function buildDomainLineageTrustSummary(
  lineageTrust?: DomainLineageTrust,
): VerificationTrustSummary["lineage"] | undefined {
  if (!lineageTrust) return undefined;
  return {
    lineageKind: lineageTrust.lineageKind,
    latestOrdinal: lineageTrust.latestOrdinal,
    allHashLinksVerified: lineageTrust.allHashLinksVerified,
    identityConsistent: lineageTrust.identityConsistent,
    fullLineageVerified: lineageTrust.fullLineageVerified,
  };
}

export function buildVerificationTrustSummary(input: {
  definitionTrust?: DefinitionVerificationResult["trust"];
  stateTrust?: StateVerificationResult["trust"];
  bindingMode: BondOutputBindingMode;
  lineageTrust?: DomainLineageTrust;
}): VerificationTrustSummary {
  return {
    ...(input.definitionTrust ? { definition: input.definitionTrust } : {}),
    ...(input.stateTrust ? { state: input.stateTrust } : {}),
    bindingMode: input.bindingMode,
    ...(input.lineageTrust ? { lineage: buildDomainLineageTrustSummary(input.lineageTrust) } : {}),
  };
}
