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

// Round 2, test case 2 (verbatim from bot-improvement-brief-round-2.md).
// Overlaps with NL 007's brick-and-mortar explanation; contains rough
// note syntax ("Like if you've...") that must not be pasted verbatim.
export const BARRIER_NOTE = `Been thinking about the skin barrier and how we explain it to customers. The stratum corneum as this - it's not really a wall, it's more like a brick and mortar structure, you've heard this metaphor, the corneocytes are the bricks and the lipid matrix is the mortar. When the mortar is compromised the wall leaks. But the thing I keep thinking about is that most people understand the concept of barrier repair without understanding that - there are different reasons the barrier gets damaged and the solution isn't always the same. Like if you've over-exfoliated you've removed corneocytes, that's different from if you've depleted the lipid matrix through harsh cleansing, that's different again from a genetic condition that affects ceramide production`;

// Mentions a real medical condition - the pipeline must point to a
// dermatologist and never give management/treatment advice.
export const ECZEMA_NOTE = `Had a customer DM asking what our serum can do for her eczema flare-ups on her hands. She wants to know if she should be using it twice a day during a flare or just once, and whether she should layer it under her prescription cream or over it. I want to write about how often we get asked to give routine advice for diagnosed skin conditions, and where the line actually is between a formulation question and a medical one.`;

// The only realistic current-angle candidate is a branded, industry-funded
// study - the brand name must never reach the draft, and the study must be
// graded as industry-funded/branded at best, never presented as independent.
export const BRANDED_STUDY_NOTE = `Reading about post-procedural skincare again - had a client ask what to use on her skin after a light chemical peel. There's a real gap in good, hedged information here. Most of what's out there is either "use nothing" or a branded moisturiser's own marketing copy dressed up as advice. Want to write about how to actually evaluate a post-procedural product claim instead of just trusting whichever brand shows up first.`;
