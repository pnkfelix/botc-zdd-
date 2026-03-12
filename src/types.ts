/**
 * Shared types for the BotC ZDD phase-chain architecture.
 */

// ---------------------------------------------------------------------------
// Re-export core role types from botc.ts (canonical source)
// ---------------------------------------------------------------------------

export { RoleType, type Role, type Script, type Distribution } from "./botc.js";

// ---------------------------------------------------------------------------
// Seat & variable encoding
// ---------------------------------------------------------------------------

/** A seat index (0-based). Seat 0 is "player 1", etc. */
export type Seat = number;

/**
 * Encoding scheme for seat-role assignment variables.
 *
 * For N players with roles indexed 0..N-1 within the selected set,
 * variable for (seat s, role index r) = s * N + r.
 *
 * This groups variables by seat, so all of seat 0's options come first,
 * then seat 1's, etc. — keeping related constraints close in the ordering.
 */
export function seatRoleVar(seat: Seat, roleIndex: number, numPlayers: number): number {
  return seat * numPlayers + roleIndex;
}

/** Decode a seat-role variable back to (seat, roleIndex). */
export function decodeSeatRoleVar(variable: number, numPlayers: number): { seat: Seat; roleIndex: number } {
  return {
    seat: Math.floor(variable / numPlayers),
    roleIndex: variable % numPlayers,
  };
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export enum PhaseType {
  Distribution = "Distribution",
  SeatAssignment = "SeatAssignment",
  TokenAssignment = "TokenAssignment",
  NightAction = "NightAction",
  DayAction = "DayAction",
}

/** Metadata for a phase in the chain. */
export interface PhaseInfo {
  type: PhaseType;
  /** Human-readable label, e.g. "Night 1", "Day 1". */
  label: string;
  /** Variable ID offset so this phase's vars don't collide with others. */
  variableOffset: number;
  /** Number of variables in this phase. */
  variableCount: number;
}

// ---------------------------------------------------------------------------
// Observations & constraints
// ---------------------------------------------------------------------------

/**
 * An observation that constrains the world space.
 *
 * Observations are typed so the constraint engine knows how to apply them.
 */
export type Observation =
  | SeatHasRole
  | SeatNotRole
  | RoleInSeat
  | RoleNotInSeat
  | RequireVariable
  | ExcludeVariable;

export interface SeatHasRole {
  kind: "seat-has-role";
  seat: Seat;
  /** Index of the role within the selected role set (not the script-wide index). */
  roleIndex: number;
}

export interface SeatNotRole {
  kind: "seat-not-role";
  seat: Seat;
  roleIndex: number;
}

export interface RoleInSeat {
  kind: "role-in-seat";
  roleIndex: number;
  seat: Seat;
}

export interface RoleNotInSeat {
  kind: "role-not-in-seat";
  roleIndex: number;
  seat: Seat;
}

export interface RequireVariable {
  kind: "require-variable";
  variable: number;
}

export interface ExcludeVariable {
  kind: "exclude-variable";
  variable: number;
}

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

export type Query =
  | CountWorlds
  | CountWithSeatRole
  | SeatProbabilities;

export interface CountWorlds {
  kind: "count-worlds";
}

export interface CountWithSeatRole {
  kind: "count-with-seat-role";
  seat: Seat;
  roleIndex: number;
}

export interface SeatProbabilities {
  kind: "seat-probabilities";
  seat: Seat;
}

export type QueryResult =
  | { kind: "count"; value: number }
  | { kind: "probabilities"; values: Map<number, number> };

// ---------------------------------------------------------------------------
// Token assignment types (Phase 3 — stubbed)
// ---------------------------------------------------------------------------

/** Represents what a player believes their role to be. */
export interface TokenInfo {
  seat: Seat;
  /** The ground-truth role index. */
  actualRoleIndex: number;
  /** The role index the player believes they are (may differ for Drunk, etc.). */
  perceivedRoleIndex: number;
}

/** ST choice for assigning deceptive tokens. */
export interface DeceptionChoice {
  /** Seat of the deceived player (e.g., the Drunk). */
  seat: Seat;
  /** The actual role in that seat. */
  actualRoleName: string;
  /** The set of roles this player could believe they are. */
  possiblePerceivedRoles: string[];
}

// ---------------------------------------------------------------------------
// Night action types (Phase 4+ — stubbed)
// ---------------------------------------------------------------------------

export enum NightActionType {
  PoisonerPick = "PoisonerPick",
  InformationRole = "InformationRole",
  DemonKill = "DemonKill",
  MonkProtection = "MonkProtection",
}

export interface NightAction {
  type: NightActionType;
  /** Acting seat. */
  seat: Seat;
  /** Target seat (if applicable). */
  target?: Seat;
  /** Information output (for information roles). */
  info?: number | string;
}
