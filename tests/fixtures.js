// Regression test notes. The first is the brief's original failing case -
// keep it exactly as given, it's the primary acceptance test.

export const LAYERING_ORDER_NOTE = `Had a message from a customer today. She said the serum she's been using for four months suddenly stopped working, felt like it wasn't absorbing, and her skin was feeling more congested than before she started using it. She hadn't changed the serum. But she had switched moisturisers two weeks ago. New moisturiser is a heavier occlusive, probably silicone-based given how she's describing the finish. She's applying it before the serum. That's the entire problem. The serum actives are landing on top of an occlusive barrier and sitting there. The absorption issue isn't the serum, it's the layering order. I want to write about this because it's such a common mistake and the customer never connects the two products. They blame the one that changed in their experience, which is the serum, even though the serum is the same as it's always been.`;

// Contains Meera's own real numbers - the pipeline must keep them exactly,
// not round them, restate them, or drop them as "unsupported".
export const OWN_NUMBERS_NOTE = `Batch fourteen came back from the manufacturer and the pH stability data looked off. I went back to the supplier and it turns out they quietly changed the preservative blend without notifying us. The finished product pH dropped by about 0.4 units, which sounds small but it's enough to push us out of the optimal range for our emollient blend. We're holding the batch. If you're not checking the CoA against a baseline every batch, you won't catch it until the customer does.`;

// Too thin to develop - triage should PARK it, not draft from it.
export const TOO_THIN_NOTE = `reorder packaging boxes, running low, check with the printer about the matte finish again`;

// Names a real supplier - the pipeline must flag/remove the name, never
// publish it (matches her never-says list: no competitors or suppliers named).
export const NAMES_SUPPLIER_NOTE = `Talked to someone at BASF today about their new UV filter and honestly the safety data package they sent over was more thorough than most of our other suppliers manage. Worth writing about the gap between how much documentation the big suppliers give you versus the smaller ones, using this as the example of what "good" actually looks like.`;
