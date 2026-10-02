//! alpha.9 Clash `/rules` strings. sing-box serves `rule.Type()`, `rule.String()`
//! and `rule.Action().String()` from route rules only. DNS rules are absent.
//! Item order and truncation follow `route/rule` in v1.15.0-alpha.9.

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClashRuleProof {
    pub type_name: String,
    pub payload: String,
    pub proxy: String,
}

pub fn expected_clash_api_rules(runtime_json: &str) -> Result<Vec<ClashRuleProof>, String> {
    let value: Value = serde_json::from_str(runtime_json).map_err(|_| "runtime is not JSON".to_string())?;
    let rules = value
        .pointer("/route/rules")
        .and_then(Value::as_array)
        .ok_or_else(|| "runtime has no route rules".to_string())?;
    rules.iter().map(render_rule).collect()
}

fn render_rule(rule: &Value) -> Result<ClashRuleProof, String> {
    refuse_unknown_keys(rule)?;
    let type_name = rule.get("type").and_then(Value::as_str).unwrap_or("default");
    let (type_name, payload) = match type_name {
        "" | "default" => ("default", render_default_payload(rule)?),
        "logical" => ("logical", render_logical(rule)?),
        other => return Err(format!("unsupported sing-box rule type {other}")),
    };
    Ok(ClashRuleProof {
        type_name: type_name.to_string(),
        payload,
        proxy: render_action(rule)?,
    })
}

fn refuse_unknown_keys(rule: &Value) -> Result<(), String> {
    let Some(object) = rule.as_object() else {
        return Err("route rule is not an object".to_string());
    };
    const ALLOWED: &[&str] = &[
        "type",
        "action",
        "outbound",
        "mode",
        "rules",
        "inbound",
        "ip_version",
        "network",
        "domain",
        "domain_suffix",
        "ip_cidr",
        "port",
        "process_name",
        "process_path_regex",
    ];
    if let Some(key) = object.keys().find(|key| !ALLOWED.contains(&key.as_str())) {
        return Err(format!("route rule field {key} is not in the alpha.9 proof"));
    }
    Ok(())
}

fn render_action(rule: &Value) -> Result<String, String> {
    match rule.get("action").and_then(Value::as_str).unwrap_or("route") {
        "route" => {
            let outbound = rule
                .get("outbound")
                .and_then(Value::as_str)
                .ok_or_else(|| "route action has no outbound".to_string())?;
            Ok(format!("route({outbound})"))
        }
        "reject" => Ok("reject".to_string()),
        "hijack-dns" => Ok("hijack-dns".to_string()),
        other => Err(format!("unsupported sing-box rule action {other}")),
    }
}

fn render_logical(rule: &Value) -> Result<String, String> {
    let op = match rule.get("mode").and_then(Value::as_str) {
        Some("and") => "&&",
        Some("or") => "||",
        _ => return Err("logical rule mode is not and/or".to_string()),
    };
    let children = rule
        .get("rules")
        .and_then(Value::as_array)
        .ok_or_else(|| "logical rule has no children".to_string())?;
    let rendered = children
        .iter()
        .map(render_default_payload)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rendered.join(&format!(" {op} ")))
}

/// `abstractDefaultRule::String`: space-joined items in `NewDefaultRule` append order.
fn render_default_payload(rule: &Value) -> Result<String, String> {
    refuse_unknown_keys(rule)?;
    let mut items = Vec::new();
    if let Some(value) = rule.get("inbound") {
        items.push(format!("inbound={}", list_body(&strings(value)?, false)));
    }
    if let Some(value) = rule.get("ip_version") {
        let version = value
            .as_u64()
            .filter(|version| *version == 4 || *version == 6)
            .ok_or_else(|| "ip_version is not 4 or 6".to_string())?;
        items.push(format!("ip_version={version}"));
    }
    if let Some(value) = rule.get("network") {
        items.push(format!("network={}", list_body(&strings(value)?, false)));
    }
    if rule.get("domain").is_some() || rule.get("domain_suffix").is_some() {
        let mut description = String::new();
        if let Some(value) = rule.get("domain") {
            description.push_str(&format!("domain={}", list_body(&strings(value)?, true)));
        }
        if let Some(value) = rule.get("domain_suffix") {
            if !description.is_empty() {
                description.push(' ');
            }
            description.push_str(&format!(
                "domain_suffix={}",
                list_body(&strings(value)?, true)
            ));
        }
        items.push(description);
    }
    if let Some(value) = rule.get("ip_cidr") {
        items.push(format!("ip_cidr={}", list_body(&strings(value)?, true)));
    }
    if let Some(value) = rule.get("port") {
        items.push(format!("port={}", list_body(&numbers(value)?, false)));
    }
    if let Some(value) = rule.get("process_name") {
        items.push(format!(
            "process_name={}",
            list_body(&strings(value)?, false)
        ));
    }
    if let Some(value) = rule.get("process_path_regex") {
        // alpha.9 keeps only the first three expressions and does not add "...".
        items.push(format!(
            "process_path_regex={}",
            list_body_truncated(&strings(value)?, false)
        ));
    }
    Ok(items.join(" "))
}

fn list_body(values: &[String], ellipsis: bool) -> String {
    list_body_truncated(values, ellipsis)
}

fn list_body_truncated(values: &[String], ellipsis: bool) -> String {
    if values.len() == 1 {
        return values[0].clone();
    }
    if values.len() > 3 {
        let head = values[..3].join(" ");
        if ellipsis {
            return format!("[{head}...]");
        }
        return format!("[{head}]");
    }
    format!("[{}]", values.join(" "))
}

fn strings(value: &Value) -> Result<Vec<String>, String> {
    match value {
        Value::String(text) => Ok(vec![text.clone()]),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| "rule list item is not a string".to_string())
            })
            .collect(),
        _ => Err("rule field is not a string or list".to_string()),
    }
}

fn numbers(value: &Value) -> Result<Vec<String>, String> {
    match value {
        Value::Number(number) => Ok(vec![number.to_string()]),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                item.as_u64()
                    .map(|port| port.to_string())
                    .ok_or_else(|| "port list item is not a number".to_string())
            })
            .collect(),
        _ => Err("port field is not a number or list".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::expected_clash_api_rules;
    use crate::catalog::CatalogRouting;
    use crate::config::{DirectPlan, RuntimePorts};
    use crate::node::{ValidatedNode, admit_node};
    use crate::sing_box::{RuntimeInput, build_runtime};
    use serde_json::Value;

    fn nodes() -> Vec<ValidatedNode> {
        let reference: Value = serde_json::from_str(include_str!(
            "../../../../../../docs/reports/sing-box-evaluation/migration-m0/reference.json"
        ))
        .unwrap();
        reference["input"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| admit_node(&serde_yaml_ng::to_value(node).unwrap()).unwrap())
            .collect()
    }

    #[test]
    fn alpha9_rules_keep_process_direct_behind_the_ai_suffix() {
        let nodes = nodes();
        let routing = CatalogRouting::default();
        let plan = DirectPlan {
            physical_interface: "Ethernet".into(),
            hosts: vec![("qq.com".into(), "101.1.2.3".into())],
            tcp_wechat_rules: vec![("qq.com".into(), "101.1.2.3".parse().unwrap(), 443)],
            tcp_web_rules: vec![],
            web_suffix_rules: vec![("aliyuncs.com".into(), 443)],
            udp_wechat_rules: vec![],
            wechat_process_path_regexes: vec![r"^C:\\WeChat\\.*$".into()],
            reviewed_direct_ports: vec![443],
        };
        let runtime = build_runtime(RuntimeInput {
            nodes: &nodes,
            selected: "Fixture Beta",
            controller_secret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
            direct_plan: Some(&plan),
            routing: &routing,
            platform: "windows-amd64-v2",
            ports: RuntimePorts {
                mixed_port: 29190,
                controller_port: 29191,
            },
            required_capabilities: &[],
            home_process_names: &[],
            home_process_path_regexes: &[],
            direct_process_names: &[],
            fake_ip_slot: 0,
        })
        .unwrap();
        let rules = expected_clash_api_rules(runtime.runtime_json()).unwrap();
        assert_eq!(rules[0].type_name, "default");
        assert_eq!(rules[0].payload, "ip_version=6");
        assert_eq!(rules[0].proxy, "reject");
        assert_eq!(rules[1].payload, "inbound=Tono-DNS");
        assert_eq!(rules[1].proxy, "hijack-dns");
        assert_eq!(rules[2].payload, "port=53");
        assert_eq!(rules[2].proxy, "hijack-dns");
        let ai = rules
            .iter()
            .position(|rule| {
                rule.payload
                    == "network=tcp domain_suffix=[dashscope.aliyuncs.com dashscope-intl.aliyuncs.com dashscope-us.aliyuncs.com...]"
                    && rule.proxy == "route(Tono-Exit)"
            })
            .expect("ai suffix");
        let process = rules
            .iter()
            .position(|rule| {
                rule.payload
                    == format!(
                        "network=tcp port=443 process_path_regex={}",
                        r"^C:\\WeChat\\.*$"
                    )
                    && rule.proxy == "route(Tono-China-Direct)"
                    && rule.type_name == "default"
            })
            .expect("process path");
        assert!(ai < process);
        let logical = rules
            .iter()
            .find(|rule| rule.type_name == "logical")
            .expect("logical");
        assert_eq!(
            logical.payload,
            "network=tcp domain=qq.com port=443 && ip_cidr=101.1.2.3/32"
        );
        assert_eq!(logical.proxy, "route(Tono-China-Direct)");
        let last = rules.last().unwrap();
        assert_eq!(last.payload, "network=[udp icmp]");
        assert_eq!(last.proxy, "reject");
        let mut widened: Value = serde_json::from_str(runtime.runtime_json()).unwrap();
        widened["route"]["rules"][0]["invert"] = Value::Bool(true);
        assert!(expected_clash_api_rules(&widened.to_string()).is_err());
    }
}
