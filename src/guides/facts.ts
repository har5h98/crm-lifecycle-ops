import type { Platform } from "../core/model.js";

// Platform behaviours that change what a check should conclude. Each one is sourced from the
// vendor's documentation (see the research notes linked in each guide file).

export interface SmsBehaviour {
  /** Text the platform appends to every marketing SMS by default (counts toward segments). */
  appendedOptOut?: string;
  /** Hard cap on segments per message; longer messages fail to send. */
  maxSegments?: number;
  source?: string;
}

export const SMS_BEHAVIOUR: Record<Platform, SmsBehaviour> = {
  // Default for new projects; set in Settings > Project Settings > Include SMS Opt-Out Instructions.
  iterable: {
    appendedOptOut: "Msg&data rates may apply. Text 'STOP' to quit.",
    source: "https://support.iterable.com/hc/en-us/articles/15521924837908-Customizing-SMS-Opt-Out-Instructions",
  },
  // No Braze doc says it appends opt-out text; compliance is the sender's responsibility.
  braze: { maxSegments: 10, source: "https://www.braze.com/docs/user_guide/channels/sms_mms_and_rcs/billing_calculator" },
  // Opt-out text is a per-message toggle (API default for flow SMS: off); 1,600-character max.
  klaviyo: { source: "https://help.klaviyo.com/hc/en-us/articles/360035285472" },
};
