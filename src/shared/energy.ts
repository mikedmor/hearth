/** The home's electricity, from the Sense energy monitor (through Sense's servers). */

/** A device Sense recognises, using power now. */
export interface EnergyDevice {
  name: string;
  watts: number;
  icon?: string;
}

/** Today so far. */
export interface EnergyToday {
  kwh: number;
  /** With solar: made, bought, sold, and how much of the home it powered. */
  solarKwh?: number;
  fromGridKwh?: number;
  toGridKwh?: number;
  solarPct?: number;
  /** The devices that used the most today. */
  top: { name: string; kwh: number }[];
}

/** What the electricity costs. Rates are in cents a kWh; money is in dollars. */
export interface EnergyCost {
  rate: number;
  /** Hearth's own setting, the rate set in the Sense app, or the area's average Sense looked up. */
  rateFrom: "hearth" | "sense" | "average";
  /** "Oregon": the area Sense found from the home's postal code, and its average. */
  area?: string;
  areaRate?: number;
  nationalRate?: number;
  /** The fixed charge on every bill. */
  fixed: number;
  /** Today so far. */
  today?: number;
  /** The bill that today is in. */
  period: {
    /** YYYY-MM-DD; `end` is the day the next bill starts. */
    start: string;
    end: string;
    days: number;
    elapsed: number;
    kwh: number;
    /** So far, with the fixed charge. */
    cost: number;
    projectedKwh?: number;
    projectedCost?: number;
  };
}

export interface EnergyNow {
  ok: boolean;
  error?: string;
  /** Last read well (ISO). */
  at?: string;
  /** The whole home, watts. */
  watts?: number;
  /** Solar made, watts (when there is solar). */
  solarWatts?: number;
  solar: boolean;
  voltage?: number[];
  hz?: number;
  /** On now, the biggest first. */
  devices: EnergyDevice[];
  today?: EnergyToday;
  /** What it costs (once Sense has said its rate, or Hearth has one). */
  cost?: EnergyCost;
  /** Watts, oldest first, about one a minute. */
  history: { watts: number[]; solar: number[] };
}

/** `GET /api/admin/sense`. */
export interface EnergyView {
  connected: boolean;
  email?: string;
  /** Sense signed Hearth out: connect it again. */
  needsSignIn: boolean;
  /** Waiting for the code from the authenticator app. */
  codePending: boolean;
  /** Hearth's own cost settings (empty: use Sense's). */
  costSettings: { rate?: number; cycleStart?: number; fixed?: number };
  /** What Sense says, for the cost form's hints. */
  senseCost?: {
    rate?: number;
    rateSetByUser: boolean;
    cycleStart?: number;
    area?: string;
    areaRate?: number;
  };
  now?: EnergyNow;
}
