export type OperatorAuthorityMode =
  | "automatic"
  | "automatic_if_configured"
  | "approval_required"
  | "owner_only"
  | "deny";

export type OperatorAuthorityClass =
  | "read_inspect"
  | "isolated_code_change"
  | "test_and_build"
  | "branch_and_commit"
  | "pull_request"
  | "staging_deploy"
  | "production_deploy"
  | "production_config_change"
  | "destructive_data_change"
  | "billing_or_purchase"
  | "identity_or_mfa"
  | "legal_attestation"
  | "secret_disclosure";

export type OperatorPolicyDecision = {
  allowed: boolean;
  approvalRequired: boolean;
  ownerOnly: boolean;
  reason: string;
};

const MODES: Record<OperatorAuthorityClass, OperatorAuthorityMode> = {
  read_inspect: "automatic",
  isolated_code_change: "automatic",
  test_and_build: "automatic",
  branch_and_commit: "automatic",
  pull_request: "automatic",
  staging_deploy: "automatic_if_configured",
  production_deploy: "approval_required",
  production_config_change: "approval_required",
  destructive_data_change: "approval_required",
  billing_or_purchase: "approval_required",
  identity_or_mfa: "owner_only",
  legal_attestation: "owner_only",
  secret_disclosure: "deny",
};

export function evaluateOperatorAuthority(input: {
  authorityClass: OperatorAuthorityClass;
  paidExecutionEnabled: boolean;
  integrationConfigured?: boolean;
}): OperatorPolicyDecision {
  const mode = MODES[input.authorityClass];

  if (
    input.authorityClass === "billing_or_purchase" &&
    !input.paidExecutionEnabled
  ) {
    return {
      allowed: false,
      approvalRequired: false,
      ownerOnly: false,
      reason: "Paid execution is disabled.",
    };
  }

  switch (mode) {
    case "automatic":
      return {
        allowed: true,
        approvalRequired: false,
        ownerOnly: false,
        reason: "Action is within automatic operator authority.",
      };

    case "automatic_if_configured":
      return input.integrationConfigured
        ? {
            allowed: true,
            approvalRequired: false,
            ownerOnly: false,
            reason: "Required integration is configured.",
          }
        : {
            allowed: false,
            approvalRequired: false,
            ownerOnly: false,
            reason: "Required integration is not configured.",
          };

    case "approval_required":
      return {
        allowed: false,
        approvalRequired: true,
        ownerOnly: false,
        reason: "Owner approval is required before execution.",
      };

    case "owner_only":
      return {
        allowed: false,
        approvalRequired: false,
        ownerOnly: true,
        reason: "This action must be completed by the account owner.",
      };

    case "deny":
    default:
      return {
        allowed: false,
        approvalRequired: false,
        ownerOnly: false,
        reason: "Action is prohibited by operator policy.",
      };
  }
}
