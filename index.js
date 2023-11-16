const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");

// AWS Configurations
const awsProfile = new pulumi.Config("aws").require("profile");
const awsRegion = new pulumi.Config("aws").require("region");
const awsVpcCidr = new pulumi.Config("vpc").require("cidrBlock");
const domaniname = new pulumi.Config().require("domainname"); 
const keyName = new pulumi.Config().require("keynamepair"); 

 
// Function to get the most recent AMI
function getMostRecentAmi() {
  // Adjust the filters to match the AMIs you're interested in
  return aws.ec2.getAmi({
    filters: [{
      name: "name",
      values: ["CSYE6225_2023*"], 
    }],
    mostRecent: true
  });
}

// Using AWS Profile
const awsDevProvider = new aws.Provider("awsdev", {
  profile: awsProfile,
  region: awsRegion,
});

// VPC
const vpc = new aws.ec2.Vpc("myVpc", {
  cidrBlock: awsVpcCidr,
  enableDnsSupport: true,
  enableDnsHostnames: true,
  tags: {
    Name: "MyVPC",
  },
});

// Function to get the availability zones
async function getAzs() {
  const zones = await aws.getAvailabilityZones({ state: "available" });
  return zones.names.slice(0, 3);
}

const azs = pulumi.output(getAzs());

// Create 3 public subnets and 3 private subnets, each in a different AZ
const publicSubnets = azs.apply((azNames) =>
  azNames.map((az, i) => {
    return new aws.ec2.Subnet(`public-subnet-${i + 1}`, {
      vpcId: vpc.id,
      cidrBlock: `10.0.${i + 1}.0/24`,
      mapPublicIpOnLaunch: true,
      availabilityZone: az,
      tags: {
        Name: `public-subnet-${i + 1}`,
      },
    });
  })
);

const privateSubnets = azs.apply((azNames) =>
  azNames.map((az, i) => {
    return new aws.ec2.Subnet(`private-subnet-${i + 1}`, {
      vpcId: vpc.id,
      cidrBlock: `10.0.${i + 4}.0/24`,
      mapPublicIpOnLaunch: false,
      availabilityZone: az,
      tags: {
        Name: `private-subnet-${i + 1}`,
      },
    });
  })
);


// Create an Internet Gateway and attach it to the VPC
const internetGateway = new aws.ec2.InternetGateway("myInternetGateway", {
  vpcId: vpc.id,
  tags: {
    Name: "MyInternetGateway",
  },
});

// Create a public route table and associate public subnets
const publicRouteTable = new aws.ec2.RouteTable("public-route-table", {
  vpcId: vpc.id,
  tags: {
    Name: "Public Route Table",
  },
});

const publicSubnetAssociations = publicSubnets.apply((subnets) =>
  subnets.map((subnet, i) => {
    return new aws.ec2.RouteTableAssociation(`public-route-table-association-${i}`, {
      routeTableId: publicRouteTable.id,
      subnetId: subnet.id,
    });
  })
);

// Create a private route table and associate private subnets
const privateRouteTable = new aws.ec2.RouteTable("private-route-table", {
  vpcId: vpc.id,
  tags: {
    Name: "Private Route Table",
  },
});

const privateSubnetAssociations = privateSubnets.apply((subnets) =>
  subnets.map((subnet, i) => {
    return new aws.ec2.RouteTableAssociation(`private-route-table-association-${i}`, {
      routeTableId: privateRouteTable.id,
      subnetId: subnet.id,
    });
  })
);

// Create a public route in the public route table to the Internet Gateway
const publicRoute = new aws.ec2.Route("public-route", {
  routeTableId: publicRouteTable.id,
  destinationCidrBlock: "0.0.0.0/0",
  gatewayId: internetGateway.id,
});




new aws.ec2.Route("internet-route", {
  routeTableId: publicRouteTable.id,
  destinationCidrBlock: "0.0.0.0/0",
  gatewayId: internetGateway.id,
});


// Example Application Security Group (customize as needed)
const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
  vpcId: vpc.id,
  description: "Application Security Group",
  tags: {
    Name: "Application Security Group",
  },
});

const dbSecurityGroup = new aws.ec2.SecurityGroup("dbSecurityGroup",{
  vpcId: vpc.id,
  description: "Database Security Group",
  tags: {
    Name: "Database Security Group",
  },
})

const dbParameterGroup = new aws.rds.ParameterGroup("dbparametergroup", {
  family: "mariadb10.5", 
  description: "Custom Parameter Group for MariaDB",
  parameters: [
      {
          name: "max_connections",
          value: "100",
      },
  ],
});



new aws.ec2.SecurityGroupRule("dbIngress", {
  type: "ingress",
  securityGroupId: dbSecurityGroup.id,
  protocol: "tcp",
  fromPort: 3306,
  toPort: 3306,
  sourceSecurityGroupId: appSecurityGroup.id,
});

new aws.ec2.SecurityGroupRule("outboundToDB", {
  type: "egress",
  securityGroupId: appSecurityGroup.id,
  protocol: "tcp",
  fromPort: 3306,
  toPort: 3306,
  sourceSecurityGroupId: dbSecurityGroup.id,
});
new aws.ec2.SecurityGroupRule("outboundToInternet", {
  type: "egress",
  securityGroupId: appSecurityGroup.id,
  protocol: "tcp",
  fromPort: 443,
  toPort: 443,
  cidrBlocks: ["0.0.0.0/0"],
});

// Output the IDs of private subnets
const privateSubnetIds = privateSubnets.apply(subnets => subnets.map(subnet => subnet.id));

const dbSubnetGroup = new aws.rds.SubnetGroup("mydbsubnetgroup", {
  subnetIds: [
    privateSubnets[0].id, // Subnet in one AZ
    privateSubnets[1].id, // Subnet in another AZ
  ],
});


new aws.ec2.SecurityGroupRule("sshIngress", {
  type: "ingress",
  securityGroupId: appSecurityGroup.id,
  protocol: "tcp",
  fromPort: 22,
  toPort: 22,
  cidrBlocks: ["0.0.0.0/0"],
});


new aws.ec2.SecurityGroupRule("httpIngress", {
  type: "ingress",
  securityGroupId: appSecurityGroup.id,
  protocol: "tcp",
  fromPort: 80,
  toPort: 80,
  cidrBlocks: ["0.0.0.0/0"],
});

new aws.ec2.SecurityGroupRule("httpsIngress", {
  type: "ingress",
  securityGroupId: appSecurityGroup.id,
  protocol: "tcp",
  fromPort: 443,
  toPort: 443,
  cidrBlocks: ["0.0.0.0/0"],
});

new aws.ec2.SecurityGroupRule("appPortIngress", {
  type: "ingress",
  securityGroupId: appSecurityGroup.id,
  protocol: "tcp",
  fromPort: 8080,  
  toPort: 8080,    
  cidrBlocks: ["0.0.0.0/0"],
});




const rdsInstance = new aws.rds.Instance("myrdsinstance", {
  allocatedStorage: 20, 
  storageType: "gp2", 
  engine: "mariadb", 
  engineVersion: "10.5", 
  instanceClass: "db.t2.micro", 
  multiAz: false,
  name: "csye6225",
  username: "csye6225",
  password: "masterpassword",
  parameterGroupName: dbParameterGroup.name, 
  vpcSecurityGroupIds: [dbSecurityGroup.id], 
  dbSubnetGroupName: dbSubnetGroup.name, 
  skipFinalSnapshot: true, 
  publiclyAccessible: false, 
});

rds_endpoint = rdsInstance.endpoint
rdwoport = rds_endpoint.apply(endpoint => {
  const parts = endpoint.split(':');
  const modifiedEndpoint = `${parts[0]}:${parts[1]}`;
  return modifiedEndpoint.slice(0, -5); 
});
db_name = rdsInstance.name
db_username= rdsInstance.username
db_password= rdsInstance.password

const ami = pulumi.output(getMostRecentAmi());

// Define an IAM role with CloudWatchAgentServerPolicy policy
const role = new aws.iam.Role("cloudwatch-agent-role", {
  assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
              Service: "ec2.amazonaws.com",
          },
      }],
  }),
});


const policyAttachment = new aws.iam.RolePolicyAttachment("cloudwatch-agent-policy-attachment", {
  role: role,
  policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
});

// Create an Instance Profile for the EC2 instance
const instanceProfile = new aws.iam.InstanceProfile("cloudwatch-agent-instance-profile", {
  role: role,
});

const webappLoadBalancer = new aws.lb.LoadBalancer("webappLoadBalancer", {
  internal: false,
  loadBalancerType: "application",
  securityGroups: [loadbalancerSecurityGroup.id],
  subnets: publicSubnetIds,
  enableDeletionProtection: false,
  tags: {
      Name: "MywebappLoadBalancer",
  },
}, { provider: awsDevProvider });

// Target Group
const targetGroup = new aws.lb.TargetGroup("targetGroup", {
  port: 6969, 
  protocol: "HTTP",
  vpcId: vpc.id,
  targetType: "instance",
  healthCheck: {
    enabled: true,
    path: "/healthz", 
    protocol: "HTTP",
    port:"6969",
    interval: 30,
    timeout: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 2,
  },
}, { provider: awsDevProvider });

// Listener
const listener = new aws.lb.Listener("listener", {
  loadBalancerArn: webappLoadBalancer.arn,
  port: 80,
  protocol: "HTTP",
  defaultActions: [{
      type: "forward",
      targetGroupArn: targetGroup.arn,
  }],
}, { provider: awsDevProvider });



const launchTemplate = new aws.ec2.LaunchTemplate("launchTemplate", {
  imageId: ami.id,
  instanceType: "t2.micro",
  keyName: keyName,
  networkInterfaces: [{
    associatePublicIpAddress: true,
    securityGroups: [appSecurityGroup.id],
  }],
  userData: pulumi.all([db_username, db_password, db_name, rdwoport])
  .apply(([user, pass, name, endpoint]) => {
    const userData = `#!/bin/bash

echo "DB_USERNAME=${user}" > /opt/csye6225/.env
echo "DB_PASSWORD=${pass}" >> /opt/csye6225/.env
echo "DB_NAME=${name}" >> /opt/csye6225/.env
echo "DB_HOST=${endpoint}" >> /opt/csye6225/.env
echo "DATABASE_URL=mysql://${user}:${pass}@${endpoint}" >> /opt/csye6225/.env


sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/csye6225/cloud-watchconfig.json -s




`;
    return Buffer.from(userData).toString('base64');
  }),

  iamInstanceProfile: {
    name: instanceProfile.name,
  },
  blockDeviceMappings: [{
    deviceName: "/dev/xvda",
    ebs: {
      volumeSize: 25,
      volumeType: "gp2",
      deleteOnTermination: true,
    },
  }],
  tags: {
    Name: "Webapp instance",
  },
}, { provider: awsDevProvider });



// Auto Scaling Group
const autoScalingGroup = new aws.autoscaling.Group("autoScalingGroup", {
  minSize: 1,
  maxSize: 3,
  desiredCapacity: 1,
  launchTemplate: {
      id: launchTemplate.id,
      version: "$Latest",
  },
  vpcZoneIdentifiers: publicSubnetIds,
  targetGroupArns: [targetGroup.arn],
  cooldown: 60,
  tags: [{
      key: "Name",
      value: "MyWebAppInstance",
      propagateAtLaunch: true,
  }],
  healthCheckType: "EC2",
  healthCheckGracePeriod: 600,
}, { provider: awsDevProvider });

// Auto Scaling Policies
const scalingupPolicy = new aws.autoscaling.Policy("scalingupPolicy", {
  scalingAdjustment: 1,
  adjustmentType: "ChangeInCapacity",
  autoscalingGroupName: autoScalingGroup.name,
  cooldown: 120,
});

const scalingdownPolicy = new aws.autoscaling.Policy("scalingdownPolicy", {
  scalingAdjustment: -1,
  adjustmentType: "ChangeInCapacity",
  autoscalingGroupName: autoScalingGroup.name,
  cooldown: 120,
});


const cpuHighAlarm = new aws.cloudwatch.MetricAlarm("cpuHighAlarm", {
  metricName: "CPUUtilization",
  namespace: "AWS/EC2",
  statistic: "Average",
  period: 60,
  evaluationPeriods: 2,
  threshold: 5,
  comparisonOperator: "GreaterThanThreshold",
  alarmActions: [scalingupPolicy.arn],
  dimensions: {
      AutoScalingGroupName: autoScalingGroup.name,
  },
});

const cpuLowAlarm = new aws.cloudwatch.MetricAlarm("cpuLowAlarm", {
  metricName: "CPUUtilization",
  namespace: "AWS/EC2",
  statistic: "Average",
  period: 60,
  evaluationPeriods: 2,
  threshold: 3,
  comparisonOperator: "LessThanThreshold",
  alarmActions: [scalingdownPolicy.arn],
  dimensions: {
      AutoScalingGroupName: autoScalingGroup.name,
  },
});

const zone = pulumi.output(aws.route53.getZone({ name: domainName, privateZone: false }, { provider: awsDevProvider }));


const DNSrecord = new aws.route53.Record("DNSrecord", {
  zoneId: zone.id,
  name: domainName  , 
  type: "A", 
  aliases: [{
      name: webappLoadBalancer.dnsName,
      zoneId: webappLoadBalancer.zoneId, 
      evaluateTargetHealth: true, 
  }],
}, { provider: awsDevProvider });

exports.loadBalancerDNSName = DNSrecord.name;
exports.loadBalancerSecurityGroupId = loadbalancerSecurityGroup.id; 

