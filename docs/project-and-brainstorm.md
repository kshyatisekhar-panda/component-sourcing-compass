# Project and First Brainstorm

One-stop document for the team. Section 1 is the project description as given to us. Section 2 is the first brainstorm output. Nothing in Section 2 is decided yet.

![Atlas Copco challenge brief](assets/challenge-brief.png)

---

# Section 1: Project Description

## 1.1 Challenge Brief

**Challenge:** Intelligent Component Sourcing & Compliance Verification
**Sponsor:** Atlas Copco
**Challenge Owner:** Finn Eklöf Klemming, Product Manager
**Hackathon:** Cline AI-Assisted Enterprise Coding Hackathon

### Context (as given)

Supply chains for complex manufacturing depend on thousands of components, where sourcing decisions must balance cost, availability, technical fit, and strict regulatory requirements. Today, this evaluation is fragmented across engineering, procurement, and compliance teams, making it slow and difficult to optimize globally.

### The Challenge

Build a PoC that automatically evaluates and recommends alternative components by matching technical specifications against supplier data, while enforcing regulatory compliance and optimizing for cost, risk, and supply resilience.

## 1.2 Problem Statement

Currently, attempting to attain this goal is highly painful for manufacturing companies because the baseline process is incredibly manual, fragmented, and slow. Specific pain points:

1. **Siloed Data and Manual Effort.** Procurement, engineering, and compliance teams are forced to manually cross-reference data across disconnected systems (ERPs, PLMs) and parse through inconsistent supplier datasheets, emails, and PDFs to evaluate a single component.
2. **Crushing Regulatory Complexity.** Keeping up with constantly evolving, market-specific environmental and legal frameworks (like RoHS, REACH, and new ESG directives) across a multi-tier supply chain is overwhelming. A single oversight can lead to severe fines, blocked market entry, or reputational damage.
3. **Paralysis During Supply Chain Disruptions.** When a component becomes unavailable or too expensive, the manual vetting process for a replacement is too slow. Companies are often forced to choose between stalling production while they vet an alternative, or rushing the approval and risking technical or compliance failures.
4. **Impossible Multi-Variable Trade-offs.** It is beyond human capacity to simultaneously optimize for cost, availability, engineering tolerances, and compliance. Teams often settle for "good enough" rather than optimal, leaving money on the table or accepting higher supply chain risks.
5. **The Burden of Proof.** End-customers and auditors increasingly demand transparent compliance documentation and carbon footprint data. Manually chasing down tier-2 and tier-3 suppliers to compile certificates and audit trails is a massive administrative headache.

## 1.3 PoC Charter

### 1.3.1 Background and Rationale

The organization manufactures complex products reliant on a diverse multi-tier supply chain. Currently, evaluating new or alternative components requires balancing technical specifications, legal frameworks, environmental compliance (e.g., RoHS, REACH, ESG directives), and market-specific regulations. The organization requires a systematic method to optimize component costs and strengthen supply chain resilience without compromising regulatory compliance or product quality.

### 1.3.2 PoC Objective

Develop and validate a prototype data-driven sourcing system. The system is designed to evaluate and recommend alternative product components by cross-referencing supplier data against internal requirements, cost parameters, availability metrics, and regulatory compliance standards.

The PoC will determine the technical feasibility and business value of automating the component discovery and validation process before committing to a full-scale implementation.

### 1.3.3 Project Scope

To maintain a controlled evaluation environment, the PoC will be restricted to:

- **Target Data:** A predefined subset of components (e.g., 50 to 100 high-volume or high-risk parts) within a specific product line.
- **Supplier Integrations:** Data inputs from a limited number of existing suppliers and a controlled sample of alternative market data sources.
- **Regulatory Frameworks:** A defined set of compliance requirements for two major target markets (e.g., China and North America), focusing on specific legal, technical, and environmental standards.

### 1.3.4 Core Capabilities to Test

- **Multi-Criteria Component Matching:** Automatically filter alternatives based on strict technical specifications and engineering tolerances.
- **Supply Chain Risk and Cost Analysis:** Compare historical and real-time data to identify alternatives with lower unit costs, reduced lead times, or lower supply disruption risks.
- **Automated Compliance Verification:** Check component data against environmental factors (e.g., carbon footprint, material toxicity) and legal requirements to ensure market viability.
- **Assurance Documentation Generation:** Produce standardized reporting formats verifying compliance and supply security, shareable with internal stakeholders and external customers.

### 1.3.5 Methodology

1. **Data Ingestion:** Aggregate technical, pricing, and availability data from internal ERP/PLM systems and external supplier databases.
2. **Rule Engine Configuration:** Define exact legal, technical, and environmental parameters that components must meet.
3. **Algorithmic Evaluation:** Run the target subset of components through the system to identify viable, lower-cost, and high-availability alternatives.
4. **Manual Validation:** Have engineering, legal, and procurement teams manually review the system's recommendations to verify accuracy and compliance.

### 1.3.6 Success Criteria (KPIs)

The PoC is successful if it achieves the following:

- **Accuracy:** 100% accuracy rate in flagging non-compliant components within the test sample.
- **Cost Optimization:** Identify technically and legally viable alternatives showing measurable cost reduction (e.g., >5%) for at least 20% of the sample group.
- **Supply Resilience:** Identify alternative suppliers or components with equal or better lead times and availability metrics.
- **Efficiency:** Time required to verify a component's technical and legal compliance is measurably reduced compared to current baseline.
- **Customer Assurance:** Generate automated compliance certificates or audit trails that meet end-customer transparency requirements.

### 1.3.7 Expected Deliverables

- A functioning software prototype or integrated dashboard demonstrating the core capabilities.
- A comparative analysis report on cost and supply chain improvements identified during the test.
- An evaluation report on the accuracy of the compliance and technical verification engine.
- A scalable architecture plan and business case detailing cost, timeline, and resource requirements for full-scale implementation.

---

# Section 2: First Brainstorm

> Status: draft from the first team brainstorm. Nothing here is decided. Choices land in a "Decisions" subsection once the team commits.

## 2.1 User and Goal

**User:** manufacturing procurement and engineering teams.

**Goal:** Discover and validate requirement-fulfilling, cost-effective product components from different reliable sources.

**Definitions**
- *Requirement-fulfilling:* fulfilling regional compliance regulations and technical needs.

### How will we prove the solution has impact?

Open question. Candidate measurements to discuss:

- Time-to-decision for a single component sourcing question, baseline vs. with the tool.
- Number of viable alternatives surfaced per component (and how many engineering / legal accept).
- Compliance flag accuracy on a held-out set of components with known regulatory verdicts.
- Cost delta for accepted alternatives vs. incumbent components.
- Auditor / customer acceptance of generated compliance documentation.

(Formal KPI candidates live in Section 1.3.6.)

## 2.2 Technologies and Mechanisms

### Building blocks on the table

- **MCP server.** Use Model Context Protocol to expose component data, supplier data, and regulatory rules as tools an LLM agent can call.
- **LLM integrations.** Investigate which models and providers fit best (cost, latency, tool use quality, structured output reliability).
- **Data aggregation, "all data in one place":**
  - API data sources (ask Finn Klemming what is available).
  - Parsing datasheets, emails, and PDFs (OCR + structured extraction).
  - Integrating with other data sources (ERP, PLM, supplier portals).
  - Sources of documentation needed for proof.
  - Homogenizing data format across sources.

### Functional modules being considered

**Compliance Requirement Calculator**
- Collect regulatory requirements for each market in one place.
- Calculate which regulations are load-bearing for each sourcing decision.
- Calculate what is required to be compliant in all markets.
- Calculate which markets will be lost if a certain sourcing decision is made.

**Multi-Variable Trade-off Decision Support**
- Help decision makers navigate cost, availability, engineering tolerances, and compliance variables together.
- Backup sourcing during supply chain disruptions.

**Validator / Proof Generator**
- Validate which requirements are fulfilled.
- Highlight violating sourcing selections.
- Generate documentation with collected proofs.

## 2.3 Open Questions for the Team

- Which two markets do we focus on for the PoC? (Charter suggests China + North America.)
- Which product line and component subset do we pick?
- Which regulatory frameworks do we model in the rule engine first? (RoHS, REACH, ESG?)
- Which data sources will Finn provide vs. which do we mock?
- Where does the LLM add unique value vs. a deterministic rule engine? (Hypothesis: parsing unstructured supplier docs, summarising trade-offs, generating audit prose.)

## 2.4 Decisions

_None yet._
