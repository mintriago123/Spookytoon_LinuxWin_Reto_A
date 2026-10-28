import json, subprocess, os, sys
from pathlib import Path

REGION=os.environ.get('AWS_REGION', 'us-east-2')
if REGION != 'us-east-2': raise SystemExit('La SCP solo permite us-east-2')
if len(sys.argv) != 2 or '@' not in sys.argv[1]: raise SystemExit('Uso: python3 infra/cloudwatch-notifications.py CORREO')
def aws(*args):
    result=subprocess.run(['aws',*args,'--region',REGION,'--output','json'],text=True,capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout) if result.stdout.strip() else {}

account=aws('sts','get-caller-identity')['Account']
topic=aws('sns','create-topic','--name','spookython-alerts')['TopicArn']
attrs=aws('sns','get-topic-attributes','--topic-arn',topic)['Attributes']
policy=json.loads(attrs.get('Policy','{"Version":"2012-10-17","Statement":[]}'))
policy['Statement']=[s for s in policy['Statement'] if s.get('Sid')!='SpookythonCloudWatchAlarms']
policy['Statement'].append({'Sid':'SpookythonCloudWatchAlarms','Effect':'Allow',
    'Principal':{'Service':'cloudwatch.amazonaws.com'},'Action':'SNS:Publish','Resource':topic,
    'Condition':{'StringEquals':{'aws:SourceAccount':account},
        'ArnLike':{'aws:SourceArn':f'arn:aws:cloudwatch:{REGION}:{account}:alarm:spookython-*'}}})
aws('sns','set-topic-attributes','--topic-arn',topic,'--attribute-name','Policy','--attribute-value',json.dumps(policy))
email=sys.argv[1]
subscriptions=aws('sns','list-subscriptions-by-topic','--topic-arn',topic)['Subscriptions']
if not any(s['Protocol']=='email' and s['Endpoint']==email for s in subscriptions):
    aws('sns','subscribe','--topic-arn',topic,'--protocol','email','--notification-endpoint',email)
subprocess.run(['bash',str(Path(__file__).with_name('cloudwatch-alarms.sh'))],env={**os.environ,'AWS_REGION':REGION,'SNS_TOPIC_ARN':topic},check=True)
subscriptions=aws('sns','list-subscriptions-by-topic','--topic-arn',topic)['Subscriptions']
print(json.dumps({'topicArn':topic,'subscriptionConfirmed':any(s['Protocol']=='email' and s['Endpoint']==email and s['SubscriptionArn']!='PendingConfirmation' for s in subscriptions),'alarmCount':4}))
